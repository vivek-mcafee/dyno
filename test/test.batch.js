var s = require('./setup')();
var test = s.test;
var es = require('event-stream');
var seedrandom = require('seedrandom');
var dyno = s.dyno;
var randomItems = require('./fixtures').randomItems;
var http = require('http');
var _ = require('underscore');

test('setup', s.setup());
test('setup table', s.setupTable);
test('putItems', function(t) {
    var items = randomItems(1000);

    dyno.putItems(items, { capacity: 'TOTAL' }, itemResp);
    function itemResp(err, resp, metas) {
        t.equal(err, null);
        t.ok(metas, 'returned metadata object');
        t.ok(metas[0].capacity, 'returned capacity info');

        dyno.scan({pages:0, capacity: 'TOTAL'}, function(err, items, metas) {
            t.ifError(err, 'completed scan');
            if (err) return t.end();
            t.equal(items.length, 1000, 'there are the right number of items in dynamo');
            t.ok(metas, 'returned metadata object');
            t.ok(metas[0].capacity, 'returned capacity info');
            t.end();
        });
    }
});

test('getItems', function(t) {
    var itemIds = randomItems(200).map(function(item) {
        return {
            id: item.id,
            range: item.range
        };
    });

    dyno.getItems(itemIds, { capacity: 'TOTAL' }, function(err, items, metas) {
        t.ifError(err, 'got items');
        if (err) return t.end();

        t.ok(metas, 'returned metadata object');
        t.ok(metas[0].capacity, 'returned capacity info');

        t.equal(items.length, 200, 'got 200 items');
        t.end();
    });
});

test('deleteItems', function(t) {
    var itemIds = randomItems(1000).map(function(item) {
        return {
            id: item.id,
            range: item.range
        };
    });

    dyno.deleteItems(itemIds, { capacity: 'TOTAL' }, itemResp);
    function itemResp(err, resp, metas) {
        t.equal(err, null);
        t.ok(metas, 'returned metadata object');
        t.ok(metas[0].capacity, 'returned capacity info');

        dyno.scan({pages:0, capacity: 'TOTAL'}, function(err, items, metas) {
            t.equal(items.length, 0, 'there are the right number of items in dynamo');
            t.ok(metas, 'returned metadata object');
            t.ok(metas[0].capacity, 'returned capacity info');
            t.end();
        });
    }
});

test('putItems: invalid item in the array', function(t) {
    var items = randomItems(25);
    items.push({
        hash: 'failure',
        span: 7
    });
    items = items.concat(randomItems(10));

    dyno.putItems(items, function(err, data) {
        t.ok(err, 'expected error');
        t.equal(err.code, 'ValidationException', 'expected error code');

        var unprocessed = err.unprocessed[Object.keys(err.unprocessed)[0]];
        t.equal(unprocessed.length, 11, 'unprocessed records returned');

        dyno.scan(function(err, items) {
            t.ifError(err, 'scan success');
            t.equal(items.length, 25, '25/36 objects written');
            t.end();
        });
    });
});

test('deleteItems: one invalid key', function(t) {
    var items = randomItems(36);
    dyno.putItems(items, function(err) {
        if (err) throw err;

        var keys = items.map(function(item) {
            return {
                id: item.id,
                range: item.range
            };
        });

        keys.pop();
        keys.push({
            hash: 'failure',
            span: 7
        });

        dyno.deleteItems(keys, function(err, data) {
            t.ok(err, 'expected error');
            t.equal(err.code, 'ValidationException', 'expected error code');

            var unprocessed = err.unprocessed[Object.keys(err.unprocessed)[0]];
            t.equal(unprocessed.length, 11, 'unprocessed records returned');

            dyno.scan(function(err, items) {
                t.ifError(err, 'scan success');
                t.equal(items.length, 11, '25/36 objects deleted');
                t.end();
            });
        });
    });
});

test('teardown', s.teardown);

test('batch adjustable concurrency', function(t) {
    function mock(assert) {
        var concurrent = 0;
        var server = http.createServer(function(req, res) {
            concurrent++;
            setTimeout(function() {
                assert.equal(concurrent, 1, 'only one outstanding request');
                concurrent--;
                res.writeHead(200);
                res.end();
            }, 100);
        });

        return {
            dyno: require('..')({
                table: 'test',
                region: 'fake',
                endpoint: 'http://localhost:3003'
            }),

            start: function(callback) {
                server.listen(3003, callback);
            },

            stop: function(callback) {
                server.close(callback);
            },

            options: {
                concurrency: 1,
                batchAttempts: 1
            }
        };
    }

    t.test('serial putItems', function(assert) {
        var server = mock(assert);
        server.start(function() {
            server.dyno.putItems(randomItems(100), server.options, function(err, result) {
                assert.ifError(err, 'success');
                server.stop(function() {
                    assert.end();
                });
            });
        });
    });

    t.test('serial getItems', function(assert) {
        var server = mock(assert);
        server.start(function() {
            server.dyno.getItems(_.range(100), server.options, function(err, result) {
                assert.ifError(err, 'success');
                server.stop(function() {
                    assert.end();
                });
            });
        });
    });

    t.test('serial putItems', function(assert) {
        var server = mock(assert);
        server.start(function() {
            server.dyno.deleteItems(_.range(100), server.options, function(err, result) {
                assert.ifError(err, 'success');
                server.stop(function() {
                    assert.end();
                });
            });
        });
    });
});

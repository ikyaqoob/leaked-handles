function applyKeyedList(obj, key, v) {
    if (!obj[key]) {
        obj[key] = [];
    }

    obj[key].push(v);
}

var tcpStacks = (function () {
    var $net = require('net');
    var $createConnection = $net.createConnection;

    var stacks = {};

    $net.createConnection = function fakeCreateConnection() {
        var stack = new Error().stack;

        var $socket = $createConnection.apply(this, arguments);

        if ($socket && $socket._handle && $socket._handle.fd) {
            var fd = $socket._handle.fd;
            applyKeyedList(stacks, fd, stack);
        } else {
            $socket.once('connect', function onConnect() {
                var fd = $socket._handle.fd;
                applyKeyedList(stacks, fd, stack);
            });
        }

        return $socket;
    };

    return stacks;
}());

var timeoutStacks = (function () {
    var $timers = require('timers');
    var $setInterval = $timers.setInterval;
    var $setTimeout = $timers.setTimeout;

    var stacks = {};

    global.setInterval = function fakeSetInterval(fn, timeout) {
        var stack = new Error().stack;

        applyKeyedList(stacks, timeout, stack);

        return $setInterval.apply(this, arguments);
    };
    $timers.setInterval = global.setInterval;
    global.setTimeout = function fakeSetTimeout(fn, timeout) {
        var stack = new Error().stack;

        applyKeyedList(stacks, timeout, stack);

        return $setTimeout.apply(this, arguments);
    };
    $timers.setTimeout = global.setTimeout;

    return stacks;
}());

var httpStacks = (function () {
    var $http = require('http');
    var $request = $http.request;

    var stacks = {};

    $http.request = function fakeRequest(options) {
        var stack = new Error().stack;

        var host = (options && options.host) ||
            (options && options.hostname) || 'void';

        applyKeyedList(stacks, host, stack);

        return $request.apply(this, arguments);
    };

    return stacks;
}());

var path = require('path');
var nodeModules = path.sep + 'node_modules' + path.sep;
var INTERVAL_HANDLE_TIMEOUT = 5001;

printHandles.INTERVAL_HANDLE_TIMEOUT = INTERVAL_HANDLE_TIMEOUT;

module.exports = printHandles;

function printHandles(console) {
    var handles = process._getActiveHandles();
    var requests = process._getActiveRequests();

    if (requests.length > 0) {
        console.log ('no of requests', requests.length);
    }

    console.log('');
    console.log('');
    console.log('no of handles', handles.length);
    handles.forEach(printHandle);
    console.log('');
    console.log('');

    function printHandle(obj) {
        if ('ontimeout' in obj) {
            if (obj && obj.msecs &&
                obj.msecs === INTERVAL_HANDLE_TIMEOUT
            ) {
                console.log('timer handle (handleInspectLoop)');
            } else if (obj && obj._repeat) {
                printTimer(obj, 'setInterval');
            } else {
                printTimer(obj, 'setTimeout');
            }
        } else if ('readable' in obj && 'writable' in obj) {
            // to debug stream handles print the _events functions
            // to string and figure out what kind of stream they are
            // then stare really hard at the source code
            // console.log(obj._events.end.toString());

            if (obj._events &&
                obj._events.close &&
                typeof obj._events.close === 'function' &&
                String(obj._events.close).indexOf('maybeClose') !== -1
            ) {
                printChildProcessStream(obj);
            } else if (obj._httpMessage) {
                printHttpStream(obj, 'http stream');
            } else if (typeof obj.allowHalfOpen === 'boolean') {
                printTcpStream(obj, 'tcp stream');
            } else {
                printStream(obj, 'stream handle');
            }
        } else if ('pid' in obj) {
            printChildProcess(obj);
        } else {
            console.log('unknown handle', obj);
        }
    }

    function printTimer(obj, name) {
        var idleTimer = (obj && obj._idlePrev) ||
            (obj && obj._idleNext);

        console.log('');

        var fnName = idleTimer && idleTimer._onTimeout &&
            idleTimer._onTimeout.name || 'fn';
        var msg = 'timer handle (`' + name + '(' + fnName + 
            ', ' + obj.msecs + ')`)';
        console.log(msg);

        if (obj.msecs && timeoutStacks[obj.msecs]) {
            printStack(timeoutStacks[obj.msecs], 'timer handle');
        }

        if (!idleTimer) {
            console.log(obj);
        } else {
            console.log('timer listener',
                String(idleTimer._onTimeout));
        }

        console.log('');
    }

    function stackLineType(line) {
        var type;
        if (line.indexOf(nodeModules) >= 0) {
            type = 'node_modules';
        } else if (line.indexOf(path.sep) >= 0) {
            type = 'default';
        } else if (line.substring(0, 5) === 'Error') {
            type = 'error';
        } else {
            type = 'node';
        }
        return type;
    }
     

    function printStack(stacks, msg, opts) {
        opts = opts || {};
        var stackMsg = msg + ' leaked at one of: \n' +
            stacks.map(function print(s) {
                var lines = s.split('\n');

                lines = lines.filter(function (line) {
                    var type = stackLineType(line);
                    return type === 'node_modules' ||
                        type === 'default';
                });

                return lines[opts.frameOffset || 1];
            }).reduce(function (acc, i) {
                if (acc.indexOf(i) === -1) {
                    acc.push(i);
                }
                return acc;
            }, []).join('\n');
        console.log(stackMsg);
    }

    function printTcpStream(obj, phrase) {
        var fd = obj._handle && obj._handle.fd;
        var readable = obj.readable;
        var writable = obj.writable;

        if (fd && tcpStacks[fd]) {
            printStack(tcpStacks[fd], 'tcp handle');
        }

        console.log(phrase, {
            fd: fd,
            readable: readable,
            writable: writable,
            address: obj.address()
        });
    }

    function printHttpStream(obj, phrase) {
        var fd = obj._handle && obj._handle.fd;
        var readable = obj.readable;
        var writable = obj.writable;

        var _httpMessage = obj._httpMessage;

        var host = _httpMessage && _httpMessage._headers &&
            _httpMessage._headers.host;

        if (host && httpStacks[host]) {
            printStack(httpStacks[host], 'http handle');
        } else if (fd && tcpStacks[fd]) {
            printStack(tcpStacks[fd], 'tcp handle');
        }

        console.log(phrase, {
            fd: fd,
            readable: readable,
            writable: writable,
            address: obj.address(),
            method: _httpMessage && _httpMessage.method,
            path: _httpMessage && _httpMessage.path,
            host: host
        });
    }

    function printStream(obj, phrase) {
        var fd = obj._handle && obj._handle.fd;
        var readable = obj.readable;
        var writable = obj.writable;

        console.log(phrase, {
            fd: fd,
            readable: readable,
            writable: writable
        });
    }

    function printChildProcessStream(obj) {
        printStream(obj, 'child process stdio stream handle');
    }

    function printChildProcess(obj) {
        console.log('child process handle', {
            pid: obj.pid
        });
    }
}
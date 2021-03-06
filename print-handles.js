var stacks = require('./stacks.js');

var path = require('path');
var process = require('process');
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
        console.log('');
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

            if (stacks.childProcess.get(obj)) {
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

        if (obj.msecs && stacks.timeout[obj.msecs]) {
            printStack(stacks.timeout[obj.msecs],
                'timer handle');
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

        if (typeof stacks === 'string') {
            stacks = [stacks];
        }

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

        if (stacks.tcp.get(obj)) {
            printStack(stacks.tcp.get(obj).stack, 'tcp handle');
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

        var httpRequest = obj._httpMessage;

        var host = httpRequest && httpRequest._headers &&
            httpRequest._headers.host;

        if (httpRequest && stacks.http.get(httpRequest)) {
            printStack(stacks.http.get(httpRequest).stack,
                'http handle');
        } else if (stacks.tcp.get(obj)) {
            printStack(stacks.tcp.get(obj).stack, 'tcp handle');
        }

        console.log(phrase, {
            fd: fd,
            readable: readable,
            writable: writable,
            address: obj.address(),
            method: httpRequest && httpRequest.method,
            path: httpRequest && httpRequest.path,
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
        if (stacks.childProcess.get(obj)) {
            var meta = stacks.childProcess.get(obj);
            printStack(meta.stack,
                'child process ' + meta.type + ' stream handle');
            printStream(obj,
                'child process ' + meta.type + ' stream handle');
        } else {
            printStream(obj,
                'child process stdio stream handle');
        }
    }

    function printChildProcess(obj) {
        var meta = stacks.childProcess.get(obj);

        if (meta) {
            printStack(meta.stack, 'child process handle');
        }

        console.log('child process handle', {
            pid: obj.pid,
            cmd: meta && meta.command,
            args: meta && meta.args
        });
    }
}

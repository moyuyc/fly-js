/**
 * Created by moyu on 2017/7/30.
 */
const express = require('express')
const getPort = require('get-port')
const nps = require('path')
const chokidar = require('chokidar')
const _ = require('lodash')
const inherits = require('util').inherits
const dirViewMiddleware = require('express-dirview-middleware')
const setWebpackMiddleware = require('./lib/setup-webpack-middleware')
const preInstall = require('./lib/pre-install')
const errorMiddleware = require('./lib/error-middleware')
const ConfigAdaptor = require('./lib/ConfigAdaptor')
const routes = require('./lib/routes')
const EntryHandler = require('./lib/EntryHandler')

function GoJS(opts) {
    this.opts = _.merge({
        verbose: true,
        path: process.cwd(),
        type: 'js',
        port: null
    }, opts)
    if (this.opts.path) {
        this.opts.path = nps.resolve(this.opts.path)
    }

    this._init()
}


GoJS.prototype._init = function () {
    this.prevCwd = process.cwd()
    process.chdir(this.opts.path)
    // process.chdir(nps.join(__dirname, '..'))

    // install after chdir
    preInstall(this.opts.type)

    this.entryHandler = new EntryHandler(this.opts.path).init()
    this.configAdaptor = new ConfigAdaptor(this.opts.path, this.opts.type)
    this.configAdaptor.on('addEntry', entry => this.emit('addEntry', entry))

    this.app = express()
    this.app.locals.opts = this.opts
    this.app.locals.entryHandler = this.entryHandler
    this.app.locals.gojs = this
    this.app.locals.configAdaptor = this.configAdaptor

    this.app.all('/', (req, res, next) => {
        res.sendFile(nps.join(__dirname, 'template/index.html'))
    });
    this.app.use('/__gojs/file-view/', dirViewMiddleware({root: this.opts.path, redirect: true}));
    this.app.use((req, res, next) => {
        const now = Date.now()
        res.on('finish', () => this.emit('request', req, res, now))
        next()
    })

    this.app.use(routes)
    this.app.use(express.static(this.opts.path))
    this.app.use(errorMiddleware)


    this.watcher = chokidar.watch(this.opts.path, {
        ignoreInitial: true,
        ignoreCase: /node_modules|\.git|^\..+|[\/\\]\..+/
    })
    this.watcher.on('unlink', fp => {
        fp = fp.substring(this.opts.path.length).replace(/^\//g, '')
        if (/jsx?$/.test(fp) && !/(node_modules)/.test(fp) && !/^\./.test(fp)) {
            this.emit('watch', 'unlink', fp)

            if (this.configAdaptor.rmEntry(fp)) {
                this.emit('rmEntry', fp)

                // setWebpackMiddleware(this.app, this.configAdaptor.getConfig())
            }
        }
    })
}


GoJS.prototype.start = function (cb) {
    const listenCallBack = (err) => {
        if (err) {
            cb && cb(err)
            this.emit('error', err)
        } else {
            this.running = true
            cb && cb(null, this.opts.port)
            this.emit('server', this.opts.port)
            if (this.opts.openSync) {
                require('opn')(`http://localhost:${this.opts.port}`)
            }
        }
    }

    if (this.opts.port) {
        this.server = this.app.listen(this.opts.port, listenCallBack)
    } else {
        getPort()
            .then(port => {
                this.opts.port = port
                this.server = this.app.listen(port, listenCallBack)
            })
            .catch(err => {
                cb && cb(err)
                this.emit('error', err)
            })
    }
}

GoJS.prototype.stop = function (cb) {
    if (!cb) cb = () => {}
    if (!this.running) {
        return cb(new Error('No server currently running.'))
    }

    if (this.running) {
        this.removeAllListeners()
        this.entryHandler.exit()
        this.watcher && this.watcher.close()
        process.chdir(this.prevCwd)
        this.server.close(cb)
        this.running = false
    }
}

inherits(GoJS, require('events').EventEmitter)

module.exports = GoJS
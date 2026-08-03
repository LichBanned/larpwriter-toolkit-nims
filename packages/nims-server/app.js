const express = require('express');
const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const passport = require('passport');
const session = require('express-session');
const errorHandler = require('errorhandler');
const compression = require('compression');
const cors = require('cors');

const config = require('./config');
const logModule = require('./libs/log');

const log = logModule(module);
const { HttpError } = require('./error');

const loader = require('./autosave/databaseLoader');
const emptyBase = require(config.get('inits:emptyBaseModule'));
const { createServerDbms } = require('nims-dbms');
const { wrapWithPermissions } = require('./permissions');
const pgBoot = require('./pg/boot');

const emptyDatabase = emptyBase.data;
const shouldEnsureAdmin = !!(
    config.get('inits:ensureAdmin')
    && config.get('inits:adminLogin')
    && config.get('inits:adminPass')
);

const dbms = { db: null, rawDb: null, preparedDb: null };
const app = express();

async function initDatabase() {
    const mode = pgBoot.storageMode();
    log.info(`NIMS_STORAGE=${mode}`);

    let seedDb = null;
    let loadedFromPg = false;
    if (mode === 'postgres') {
        seedDb = await pgBoot.loadBootDatabase();
        loadedFromPg = seedDb != null;
    }
    if (seedDb == null) {
        seedDb = loader.loadLastDatabase();
    }
    if (seedDb == null) {
        log.info('init from default base');
        seedDb = emptyBase.data;
    }

    // Do not createAdmin on empty engine before setDatabase when loading Postgres:
    // preserveManagementInfo merge would keep the fresh env hash and wipe real passwords
    // on the boot-time persistDatabase below.
    const db = createServerDbms(
        emptyDatabase,
        (!loadedFromPg && shouldEnsureAdmin)
            ? {
                adminLogin: config.get('inits:adminLogin'),
                adminPass: config.get('inits:adminPass'),
            }
            : undefined,
    );
    const { attachHistoryAndProjectsApi } = require('./pg/attachApi');
    attachHistoryAndProjectsApi(db, dbms);

    const preparedDb = wrapWithPermissions(db);
    dbms.rawDb = db;
    const getSnapshot = () => db.getDatabase();
    dbms.db = pgBoot.wrapDbForPersist(db, getSnapshot);
    dbms.preparedDb = pgBoot.wrapDbForPersist(preparedDb, getSnapshot);

    await db.setDatabase({
        database: seedDb,
        // Boot replaces engine MI with the seed document as-is (PG or JSON file).
        // UI/API imports use preserveManagementInfo: true so users/accounts stay untouched.
        preserveManagementInfo: false,
    });

    if (shouldEnsureAdmin) {
        const adminLogin = config.get('inits:adminLogin');
        let adminPasswordAlreadySet = false;
        if (mode === 'postgres') {
            try {
                const { withClient } = require('../nims-dbms/pg/storage');
                adminPasswordAlreadySet = await withClient(async (client) => {
                    const r = await client.query(
                        `SELECT 1 FROM accounts
                         WHERE username = $1
                           AND salt IS NOT NULL AND salt <> ''
                           AND password_hash IS NOT NULL AND password_hash <> ''
                         LIMIT 1`,
                        [adminLogin],
                    );
                    return r.rows.length > 0;
                });
            } catch (err) {
                log.error(`admin password check: ${err && err.message ? err.message : err}`);
            }
        } else {
            const info = db.database
                && db.database.ManagementInfo
                && db.database.ManagementInfo.UsersInfo
                && db.database.ManagementInfo.UsersInfo[adminLogin];
            adminPasswordAlreadySet = !!(info && info.salt && info.hashedPassword);
        }
        if (adminPasswordAlreadySet) {
            log.info(`admin "${adminLogin}" already has a password; skip NIMS_ADMIN_PASS seed`);
        } else {
            await db.ensureAdminExists(adminLogin, config.get('inits:adminPass'));
            log.info(`admin "${adminLogin}" credentials seeded from env (was missing)`);
        }
    }

    if (mode === 'postgres') {
        const serverAdminName = process.env.NIMS_SERVER_ADMIN || config.get('inits:adminLogin');
        if (serverAdminName) {
            try {
                const { setAccountServerAdmin } = require('../nims-dbms/pg/projectsApi');
                const { withClient } = require('../nims-dbms/pg/storage');
                await withClient((client) => setAccountServerAdmin(client, serverAdminName, true));
                log.info(`server-admin ensured for ${serverAdminName}`);
            } catch (err) {
                log.error(`server-admin bootstrap: ${err && err.message ? err.message : err}`);
            }
        }
    }

    try {
        const checkResult = await db.getConsistencyCheckResult();
        checkResult.errors.forEach((str) => console.error(str));
        if (checkResult.errors.length > 0) {
            log.info('overview-consistency-problem-detected');
        } else {
            log.info('Consistency check didn\'t find errors');
        }
    } catch (err) {
        log.error(err);
    }

    // Persist only when we bootstrapped a missing project — never rewrite passwords on every start.
    if (mode === 'postgres' && !loadedFromPg) {
        await pgBoot.persistDatabase(await db.getDatabase());
        log.info(`PostgreSQL project slug=${pgBoot.projectSlug()} persisted (initial)`);
    } else if (mode === 'postgres') {
        log.info(`PostgreSQL project slug=${pgBoot.projectSlug()} loaded (skip boot persist)`);
    }

    require('./autosave')(dbms.db);
}

const sessionOptions = config.get('session');

app.use(logger('dev', {
    immediate: true,
    format: 'dev'
}));
app.use(logger('dev', {
    format: 'dev'
}));

if (config.get('api:enabled')) {
    const allowlist = config.get('api:corsOrigins');
    const origins = Array.isArray(allowlist) ? allowlist.filter(Boolean) : [];
    const corsOpts = {
        origin: origins.length > 0
            ? (origin, cb) => {
                if (!origin || origins.includes(origin)) cb(null, true);
                else cb(new Error('CORS origin denied'));
            }
            : false,
        credentials: true,
    };
    app.use(cors(corsOpts));
    app.options('*', cors(corsOpts));
}
log.info(`api enabled: ${config.get('api:enabled')}`);
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

app.set('trust proxy', 1);
const sessionOpts = { ...sessionOptions };
const cookieOpts = { ...(sessionOpts.cookie || {}) };
if (config.get('session:cookie:secure') || process.env.NIMS_COOKIE_SECURE === '1') {
    cookieOpts.secure = true;
}
if (cookieOpts.sameSite == null) cookieOpts.sameSite = 'lax';
if (cookieOpts.httpOnly == null) cookieOpts.httpOnly = true;
sessionOpts.cookie = cookieOpts;
app.use(session(sessionOpts));
app.use(passport.initialize());
app.use(passport.session());

if (config.get('compression:enabled')) {
    app.use(compression());
}
log.info(`compression enabled: ${config.get('compression:enabled')}`);

const frontendDir = path.resolve(__dirname, config.get('frontendPath'));
app.use(express.static(frontendDir));

app.use((err, req, res, next) => {
    console.error(`${new Date().toString()} ${err}`);
    if (typeof err === 'number') {
        err = new HttpError(err);
    }

    if (err instanceof HttpError) {
        res.sendHttpError(err);
    } else if (err.name === 'ValidationError') {
        res.sendValidationError(err);
    } else if (app.get('env') === 'development') {
        errorHandler()(err, req, res, next);
    } else {
        log.error(err);
        err = new HttpError(500);
        res.sendHttpError(err);
    }
});

process.on('unhandledRejection', (error, p) => {
    console.log('Unhandled Rejection at: Promise', p, 'error:', error, 'stack', error ? error.stack : error);
});

const appReady = initDatabase().then(() => {
    require('./boot')(app, dbms);
    require('./middlewares')(app, dbms);
    require('./mcp')(app, dbms);
    require('./routes')(app, dbms);

    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/mcp')) return next();
        const indexPath = path.join(frontendDir, 'index.html');
        res.sendFile(indexPath, (err) => { if (err) next(); });
    });
}).catch((err) => {
    log.error(err);
    process.exit(1);
});

app.ready = appReady;
module.exports = app;

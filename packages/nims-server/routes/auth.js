const passport = require('passport');
const log = require('../libs/log')(module);
const { createRateLimiter } = require('../middlewares/rateLimit');
const pgBoot = require('../pg/boot');
const {
    withClient,
    setAccountPassword,
} = require('../../nims-dbms/pg/storage');

const authRateLimit = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    message: 'Too many login attempts, try again later',
});

function sessionLogIn(req, user) {
    return new Promise((resolve, reject) => {
        const finish = () => {
            req.logIn(user, (loginErr) => {
                if (loginErr) reject(loginErr);
                else resolve();
            });
        };
        if (typeof req.session.regenerate === 'function') {
            req.session.regenerate((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                finish();
            });
            return;
        }
        finish();
    });
}

module.exports = function (app, dbms) {
    const db = dbms.db;

    /** Current session user (SPA bootstrap). */
    app.get('/me', (req, res) => {
        if (!req.user || !req.user.name) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        res.json({
            user: {
                name: req.user.name,
                role: req.user.role,
                projectId: req.user.projectId || null,
                projectSlug: req.user.projectSlug || null,
                isServerAdmin: !!req.user.isServerAdmin,
            },
        });
    });

    /** Public: whether self-registration is open (for LoginPage). */
    app.get('/signup-status', (req, res, next) => {
        db.getPlayersOptions()
            .then((opts) => {
                const allow = !!(opts && opts.allowPlayerCreation);
                res.json({
                    allowPlayerCreation: allow,
                    message: allow
                        ? null
                        : 'Саморегистрация отключена для текущего проекта. Войдите с существующим логином или обратитесь к мастеру.',
                });
            })
            .catch(next);
    });

    app.post('/login', authRateLimit, (req, res, next) => {
        passport.authenticate('local', (err, user, info) => {
            if (err) {
                next(err);
                return;
            }
            if (!user) {
                res.status(401).json({
                    error: 'Invalid credentials',
                    message: (info && info.message) || 'Неверный логин или пароль',
                });
                return;
            }
            sessionLogIn(req, user).then(async () => {
                // Align in-memory project with the account's project from auth.
                if (pgBoot.storageMode() === 'postgres' && user.projectSlug
                    && typeof db.setCurrentProject === 'function'
                    && user.projectSlug !== pgBoot.projectSlug()) {
                    try {
                        await db.setCurrentProject({ slug: user.projectSlug }, user);
                    } catch (err) {
                        log.error(`login setCurrentProject: ${err && err.message ? err.message : err}`);
                    }
                }
                const wantsJson = (req.get('Accept') || '').includes('application/json')
                    || req.get('X-Requested-With') === 'XMLHttpRequest'
                    || req.query.format === 'json';
                if (wantsJson) {
                    res.json({
                        user: {
                            name: user.name,
                            role: user.role,
                            projectId: user.projectId || null,
                            projectSlug: user.projectSlug || null,
                            isServerAdmin: !!user.isServerAdmin,
                        },
                    });
                    return;
                }
                res.redirect('page.html');
            }).catch(next);
        })(req, res, next);
    });

    app.post('/logout', (req, res) => {
        const name = req.user && req.user.name;
        if (name) log.info(`logout ${name}`);
        req.logout();
        req.session.destroy(() => {
            const wantsJson = (req.get('Accept') || '').includes('application/json')
                || req.get('X-Requested-With') === 'XMLHttpRequest';
            if (wantsJson) {
                res.json({ ok: true });
                return;
            }
            res.redirect('/');
        });
    });

    app.post('/signUp', authRateLimit, (req, res, next) => {
        const body = req.body || {};
        const userName = (body.userName || body.username || '').trim();
        const password = body.password || '';
        const confirmPassword = body.confirmPassword || body.passwordConfirm || password;

        db.getPlayersOptions()
            .then((opts) => {
                if (!opts || !opts.allowPlayerCreation) {
                    res.status(403).json({
                        error: 'Forbidden',
                        message: 'Регистрация закрыта. Обратитесь к администратору.',
                    });
                    return null;
                }
                return db.signUp({ userName, password, confirmPassword });
            })
            .then(async (result) => {
                if (result === null) return null;
                // Persist login credentials into accounts (source of truth), not only active project MI.
                if (pgBoot.storageMode() === 'postgres') {
                    try {
                        const info = db.database
                            && db.database.ManagementInfo
                            && db.database.ManagementInfo.PlayersInfo
                            && db.database.ManagementInfo.PlayersInfo[userName];
                        if (info && info.salt && info.hashedPassword) {
                            await withClient(async (client) => {
                                await setAccountPassword(
                                    client,
                                    userName,
                                    info.salt,
                                    info.hashedPassword,
                                    'player',
                                );
                            });
                            delete info.salt;
                            delete info.hashedPassword;
                        }
                    } catch (err) {
                        log.error(`signup accounts sync: ${err && err.message ? err.message : err}`);
                    }
                }
                return db.login({ username: userName, password })
                    .then((user) => sessionLogIn(req, user).then(() => {
                        res.json({
                            user: {
                                name: user.name,
                                role: user.role,
                                projectId: user.projectId || null,
                                projectSlug: user.projectSlug || null,
                                isServerAdmin: !!user.isServerAdmin,
                            },
                        });
                    }));
            })
            .catch((err) => {
                if (res.headersSent) return;
                const msg = (err && (err.messageId || err.message)) || 'Ошибка регистрации';
                const text = String(msg).replace(/^errors-/, '').replace(/-/g, ' ');
                res.status(400).json({
                    error: 'SignupFailed',
                    message: String(msg).startsWith('errors-') ? text : String(msg),
                    messageId: err.messageId || err.message,
                });
            });
    });
};

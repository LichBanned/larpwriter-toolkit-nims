const passport = require('passport');
const AuthLocalStrategy = require('passport-local').Strategy;
const crypto = require('crypto');

const log = require('../libs/log')(module);
const pgBoot = require('../pg/boot');

const SCRYPT_PREFIX = 'scrypt$';
const SCRYPT_KEYLEN = 64;

function verifyPassword(salt, hashedPassword, password) {
    if (!salt || !hashedPassword) return false;
    if (String(salt).startsWith(SCRYPT_PREFIX)) {
        const saltHex = String(salt).slice(SCRYPT_PREFIX.length);
        const hash = crypto.scryptSync(password, saltHex, SCRYPT_KEYLEN).toString('hex');
        const a = Buffer.from(hash, 'hex');
        const b = Buffer.from(hashedPassword, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    return false;
}

async function resolveSessionUser(userStorage, parsed) {
    if (!parsed || !parsed.name) return null;
    const name = parsed.name;
    const org = await userStorage.getUser({ username: name, type: 'organizer' });
    if (org) return { name: org.name || name, role: 'organizer' };
    const player = await userStorage.getUser({ username: name, type: 'player' });
    if (player) return { name: player.name || name, role: 'player' };
    return null;
}

module.exports = function (app, dbms) {
    const userStorage = dbms.db;

    passport.use('local', new AuthLocalStrategy(function (username, password, callback) {
        const finish = (user) => {
            if (user && pgBoot.storageMode() === 'postgres') {
                user.projectSlug = user.projectSlug || pgBoot.projectSlug();
            }
            callback(null, user);
        };

        const tryEngine = () => userStorage.login({ username, password })
            .then((user) => finish(user))
            .catch(() => callback(null, false, { message: 'Неверный логин или пароль' }));

        if (pgBoot.storageMode() !== 'postgres') {
            tryEngine();
            return;
        }

        pgBoot.verifyAccountPassword(username, password, verifyPassword)
            .then((auth) => {
                if (!auth) {
                    tryEngine();
                    return;
                }
                return userStorage.login({ username, password })
                    .then((user) => {
                        user.projectSlug = auth.projectSlug || pgBoot.projectSlug();
                        user.projectId = auth.projectId || null;
                        finish(user);
                    })
                    .catch(() => {
                        finish({
                            name: username,
                            role: auth.kind === 'player' ? 'player' : 'organizer',
                            projectSlug: auth.projectSlug || pgBoot.projectSlug(),
                            projectId: auth.projectId || null,
                        });
                    });
            })
            .catch(() => tryEngine());
    }));

    passport.serializeUser((user, done) => {
        log.info(`user ${JSON.stringify(user)}`);
        done(null, JSON.stringify({
            name: user.name,
            role: user.role,
            projectId: user.projectId || null,
            projectSlug: user.projectSlug || null,
        }));
    });

    passport.deserializeUser((data, done) => {
        let parsed;
        try {
            parsed = JSON.parse(data);
        } catch (err) {
            log.info(`err ${err}`);
            done(err);
            return;
        }
        resolveSessionUser(userStorage, parsed)
            .then((user) => {
                if (!user) {
                    done(null, false);
                    return;
                }
                if (pgBoot.storageMode() === 'postgres') {
                    user.projectSlug = parsed.projectSlug || pgBoot.projectSlug();
                    user.projectId = parsed.projectId || null;
                }
                log.info(`user ${JSON.stringify(user)}`);
                done(null, user);
            })
            .catch((err) => done(err));
    });
};

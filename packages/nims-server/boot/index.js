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

function sessionUserShape(user) {
    return {
        name: user.name,
        role: user.role,
        projectId: user.projectId || null,
        projectSlug: user.projectSlug || null,
        isServerAdmin: !!user.isServerAdmin,
    };
}

async function resolveSessionUser(userStorage, parsed) {
    if (!parsed || !parsed.name) return null;
    const name = parsed.name;
    if (pgBoot.storageMode() === 'postgres') {
        const flags = await pgBoot.getMembershipFlags(name, parsed.projectSlug);
        if (flags) {
            const role = parsed.projectSlug && flags.projectSlug === parsed.projectSlug
                ? (flags.role || parsed.role)
                : (parsed.role || flags.role || 'organizer');
            return {
                name,
                role: role || 'organizer',
                projectId: parsed.projectId || flags.projectId || null,
                projectSlug: parsed.projectSlug || flags.projectSlug || null,
                isServerAdmin: !!flags.isServerAdmin || !!parsed.isServerAdmin,
            };
        }
    }
    const org = await userStorage.getUser({ username: name, type: 'organizer' });
    if (org) {
        return {
            name: org.name || name,
            role: 'organizer',
            projectId: parsed.projectId || null,
            projectSlug: parsed.projectSlug || null,
            isServerAdmin: !!parsed.isServerAdmin,
        };
    }
    const player = await userStorage.getUser({ username: name, type: 'player' });
    if (player) {
        return {
            name: player.name || name,
            role: 'player',
            projectId: parsed.projectId || null,
            projectSlug: parsed.projectSlug || null,
            isServerAdmin: !!parsed.isServerAdmin,
        };
    }
    return null;
}

module.exports = function (app, dbms) {
    const userStorage = dbms.db;

    passport.use('local', new AuthLocalStrategy(function (username, password, callback) {
        const finish = (user) => {
            if (user && pgBoot.storageMode() === 'postgres') {
                user.projectSlug = user.projectSlug || null;
                user.projectId = user.projectId || null;
                user.isServerAdmin = !!user.isServerAdmin;
            }
            callback(null, user);
        };

        const tryEngine = () => userStorage.login({ username, password })
            .then(async (user) => {
                if (pgBoot.storageMode() === 'postgres') {
                    const flags = await pgBoot.getMembershipFlags(username);
                    if (flags) {
                        user.isServerAdmin = !!flags.isServerAdmin;
                        if (flags.projectSlug && !user.projectSlug) {
                            user.projectSlug = flags.projectSlug;
                            user.projectId = flags.projectId;
                        }
                        if (flags.role) user.role = flags.role;
                    }
                }
                finish(user);
            })
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
                        user.projectSlug = auth.projectSlug || null;
                        user.projectId = auth.projectId || null;
                        user.isServerAdmin = !!auth.isServerAdmin;
                        if (auth.role) user.role = auth.role;
                        finish(user);
                    })
                    .catch(() => {
                        finish({
                            name: username,
                            role: auth.role || (auth.kind === 'player' ? 'player' : 'organizer'),
                            projectSlug: auth.projectSlug || null,
                            projectId: auth.projectId || null,
                            isServerAdmin: !!auth.isServerAdmin,
                        });
                    });
            })
            .catch(() => tryEngine());
    }));

    passport.serializeUser((user, done) => {
        log.info(`user ${JSON.stringify(sessionUserShape(user))}`);
        done(null, JSON.stringify(sessionUserShape(user)));
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
                log.info(`user ${JSON.stringify(user)}`);
                done(null, user);
            })
            .catch((err) => done(err));
    });
};

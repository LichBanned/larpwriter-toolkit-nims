const fs = require('fs');
const path = require('path');
const config = require('../config');
const log = require('../libs/log')(module);
const { storageMode, persistDatabase } = require('../pg/boot');

module.exports = (db) => {
    const mode = storageMode();
    const interval = config.get('autosave:interval') || 60000;

    if (mode === 'postgres') {
        log.info('autosave: PostgreSQL write-through mode');
        setInterval(() => {
            db.getDatabase().then((data) => {
                persistDatabase(data).catch((err) => console.error('postgres autosave', err));
            }).catch((err) => console.error(err));
        }, interval);
        return;
    }

    const copyNumber = config.get('autosave:copyNumber');
    const root = config.get('autosave:root');
    const projectName = config.get('inits:projectName');
    const instanceName = config.get('instanceName');

    if (!fs.existsSync(root)) {
        throw Error(`Dir not exists: ${root}`);
    }

    let curIndex = 0;
    setInterval(() => {
        log.info(curIndex++);
        if (curIndex >= copyNumber) {
            curIndex = 0;
        }
        const filePath = path.normalize(path.join(root, `${instanceName}-${projectName}-base${curIndex + 1}.json`));
        log.info(`filePath:${filePath}`);

        try {
            // getDatabase() strips credentials for export; json-mode auth still lives in MI —
            // persist the in-memory document so logins survive restart.
            const raw = structuredClone(db.database);
            if (raw.Meta) raw.Meta.saveTime = new Date().toString();
            fs.writeFile(filePath, JSON.stringify(raw, null, 2), (err2) => {
                if (err2) { console.error(err2); }
            });
        } catch (err) {
            console.error(err);
        }
    }, interval);
};

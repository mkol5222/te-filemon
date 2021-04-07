const chokidar = require('chokidar');
const mv = require('mv');

const { teInvestigate } = require('./src/te')

// monitor FS events on /files/in
chokidar.watch('/files/in', { awaitWriteFinish: true }).on('all', async (event, path) => {

  console.log(event, path);
  
  // when file is added or changed
  if (event === 'add' || event === 'change') {
    try {

      const res = await teInvestigate(path);
      //console.log(res);

      if (res && res.response && res.response.te && res.response.te.combined_verdict) {

        // benign - MOVE
        // error, malicious, ... - QUARANTINE
        let action = (res.response.te.combined_verdict === 'benign') ? 'MOVE' : 'QUARANTINE'
        console.log(`${action} ${path} - ${res.response.te.combined_verdict}`)

        if (action === 'MOVE') {
          mv(path, `/files/out/${path.replace(/^\/files\/in\//,'')}`, {mkdirp: true}, function(err) {
            if (err) {
              console.error('FAILED to move ${path}')
            } else {
              console.log(`done moving ${path}`)
            }
          });
        }

        if (action === 'QUARANTINE') {
          mv(path, `/files/q/${path.replace(/^\/files\/in\//,'')}`, {mkdirp: true}, function(err) {
            if (err) {
              console.error('FAILED to quarantine ${path}')
            } else {
              console.log(`done quarantine of ${path}`)
            }
          });
        }

      }
    } catch (err) {
      console.error('ERROR:', err);
    }
  }
});

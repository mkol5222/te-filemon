const fs = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const fetch = require("node-fetch");
const FormData = require('form-data');
const { createReadStream, mkdir } = require('fs');
const sleep = require('sleep-promise');
const {createWriteStream} = require('fs');
const {pipeline} = require('stream');
const {promisify} = require('util');

const { v4: uuidv4 } = require('uuid');
const { stringify } = require('querystring');
//uuidv4(); // ⇨ '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'

var contentDisposition = require('content-disposition');

// bring your own API key
const teApiKey = 'TE_API_KEY_lk5sUl5Klfkj4o0SloGFwKxaQXUfEWbyiIK5dBpk';

const config = {
    teApiKey,
    teServer: 'te.checkpoint.com', // TE cloud service
    maxFilesize: 1024 * 1024 * 50, // max file size - e.g. 50 MB
    queryInterval: 30000 // interval between TE query API calls: 30 sec.
}

async function isFile(filename) {
    try {
        const stats = await fs.stat(filename)
        return stats.isFile()
    } catch (err) {
        throw new Error(`te: isFile: ${filename} ${JSON.stringify(err)}`);
    }
}

async function fileSize(filename) {
    try {
        const stats = await fs.stat(filename)
        return stats.size
    } catch (err) {
        throw new Error(`te: fileSize: ${filename} ${JSON.stringify(err)}`);
    }
}

async function fileSha1(filename) {
    try {
        const algo = 'sha1';
        const shasum = crypto.createHash(algo);

        const fileContent = await fs.readFile(filename);
        shasum.update(fileContent);

        return shasum.digest('hex');
    } catch (err) {
        throw new Error(`te: fileSha1: ${filename} ${JSON.stringify(err)}`);
    }
}

async function buildQuery(filename) {
    try {
        const sha1 = await fileSha1(filename)

        const query = {
            request: [{
                sha1: sha1,
                file_type: path.extname(filename).substring(1),
                file_name: path.basename(filename),
                features: ["te"],
                te: { reports: ["pdf", "xml", "tar", "full_report"] }
            }
            ]
        }
        return query;
    } catch (err) {
        throw new Error(`te: buildQuery: ${filename} ${JSON.stringify(err)}`);
    }
}

async function teQuota() {
    const url = `https://${config.teServer}/tecloud/api/v1/file/quota`;
    try {
        const res = await fetch(url, {
            method: "post",
            headers: { "Content-Type": "application/json", "Authorization": config.teApiKey }
        })

        const json = await res.json()
        return json
    } catch (err) {
        throw new Error(`te: teQuota: ${JSON.stringify(err)}`);
    }
}

async function isLicenseValid() {
    try {
        const r = await teQuota()
        let isValid = r && r.response && r.response[0] && r.response[0].action && r.response[0].action === 'ALLOW'
        isValid = (typeof isValid === 'undefined') ? false : isValid
        return isValid
    } catch (err) {
        throw new Error(`te: isLicenseValid: ${JSON.stringify(err)}`);
    }
}

async function teQuery(filename) {

    try {
        const url = `https://${config.teServer}/tecloud/api/v1/file/query`;
        //const url = `http://localhost:4444/tecloud/api/v1/file/query`;
        const body = await buildQuery(filename)
        // console.log(JSON.stringify(body))
        const res = await fetch(url, {
            method: "post",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", "Authorization": config.teApiKey }
        })

        const json = await res.json();
        return json
    } catch (err) {
        throw new Error(`te: teQuery: ${filename} ${JSON.stringify(err)}`);
    }
}

async function teUpload(filename) {

    try {
        const url = `https://${config.teServer}/tecloud/api/v1/file/upload`;
        //const url = `http://localhost:4444/tecloud/api/v1/file/upload`;
        const requestQuery = await buildQuery(filename);

        const readStream = createReadStream(filename);

        const form = new FormData();
        form.append('file', readStream);
        form.append('request', JSON.stringify(requestQuery));


        const res = await fetch(url, {
            method: "post",
            body: form,
            headers: { ...form.getHeaders(), "Authorization": config.teApiKey }
        })

        const json = await res.json()
        return json
    } catch (err) {
        throw new Error(`te: teUpload: ${filename} ${JSON.stringify(err)}`);
    }
}

async function teDownload(downloadId, reportPath) {
    const url = `https://${config.teServer}/tecloud/api/v1/file/download?id=${downloadId}`;
    try {
        const res = await fetch(url, {
            method: "get",
            headers: { "Authorization": config.teApiKey }
        })
        const streamPipeline = promisify(pipeline);

        if (!res.ok) return { error: `teDownload: unexpected response ${res.statusText}` };

        //const filename = `./report-${downloadId}.bin`
        // console.log('teDownload res', res.headers, res.headers['content-disposition']);
        // console.log(...res.headers);
        // console.log(JSON.stringify(...res.headers, null, 2), res.headers.get('content-disposition'));
        // console.log(contentDisposition.parse(res.headers.get('content-disposition')));
        const cd = contentDisposition.parse(res.headers.get('content-disposition'));
        const fn = cd.parameters.filename; // proposed file name
        // console.log(reportPath, fn);
        const dirname = path.dirname(reportPath)
        const filename = reportPath+'_'+fn;
        try {
            await fs.mkdir(dirname, {recursive: true})
            await streamPipeline(res.body, createWriteStream(reportPath+'_'+fn));
            return { filename: filename };
        //const json = await res.json()
        } catch (err) {
            return { error: `${err}` };
        }
    } catch (err) {
        throw new Error(`te: teDownload: ${JSON.stringify(err)}`);
    }
}

function reportList(response) {
    // console.log(`reportList`, response);
    const reports = [];
    if (response.te.status.code === 1001 && response.te.combined_verdict === 'malicious') {
        for (const image of response.te.images) {
            console.log(JSON.stringify(image))
            const imageId = image.id;
            for (const r of Object.keys(image.report)) {
                if (r !== 'verdict') {
                    // console.log(r, image.report[r], `${imageId}/${r}/${image.report[r]}`)
                    reports.push(
                        {
                            reportId: image.report[r],
                            reportPath: `${imageId}/${r}/${image.report[r]}`
                        }
                    )
                }
            }
        }
    }
    return reports;
}

async function demo() {
    // const filename = 'neni.tu'
    const filename = './test-folder/zmocneni-k-vyzvednuti-ditete-z-mS-2014.pdf'
    // console.log(await isFile(filename))
    // console.log(await fileSize(filename))
    // console.log(await fileSha1(filename))
    // console.log(await buildQuery(filename))
    // console.log(await teQuota())
    // console.log(await isLicenseValid())
    // console.log(await teQuery(filename))
    // console.log(await teUpload(filename))
    const downloadId = "a1ccb7fb-71c0-4e2a-b134-2b51880c4b65"
    console.log(await teDownload(downloadId))
}

// (async () => {
//     await demo();
// })() 

const debugLog = console.log.bind(console);

async function teInvestigate(filename) {
    const eventId = uuidv4();
    debugLog(`teInvestigate [${eventId}]: handling new file ${filename}`)
    const startTs = Date.now();
    try {
        if (! await isLicenseValid()) {
            debugLog(`teInvestigate: invalid license. returning`)
            return { error: "Invalid license" }
        }
        if (! await isFile(filename)) {
            debugLog(`teInvestigate: ${filename} is not file. returning`)
            return { error: `not file` }
        }
        const fSize = await fileSize(filename)
        if (fSize > config.maxFilesize) {
            debugLog(`teInvestigate: ${filename} too large (> ${config.maxFilesize}). returning`)
            return { error: `file too large` }
        }
        let status = -1;
        let queryResult = await teQuery(filename)
            
        while (true) {
            
            let delta = Date.now() - startTs
            debugLog(`[+ ${delta} ms]`,JSON.stringify(queryResult))
            
            let response;
            if (typeof queryResult.response[0] === 'undefined') {
                response = queryResult.response
            } else {
                response = queryResult.response[0]
            }
            if (response.status && response.status.code) {
                status = response.status.code;
            } else {
                console.error('ERROR: status not set')
                break;
            }

            switch (status) {
                case 1001: // found
                    for (const r of reportList(response)) {
                        const downloadRes = await teDownload(r.reportId, `/reports/${eventId}/${r.reportPath}`)
                        debugLog(`REPORT downloaded as ${downloadRes.filename}`, `for file ${filename}`)
                    }
                    debugLog(`FOUND file ${filename} combined verdict ${queryResult.response[0].te['combined_verdict']}`)
                    debugLog(`[+ ${delta} ms] teInvestigate [${eventId}]: done with file ${filename}`)
                    return {
                        response: queryResult.response[0]
                    }
                    break;
                case 1004: // not found
                case 1006: // partially found
                    debugLog(`uploading file ${filename}`);
                    queryResult = await teUpload(filename);
                    break;

                case 1002: // upload success
                    debugLog(`upload sucessful [+ ${delta} ms]: ${filename}`);
                    await sleep(config.queryInterval); // Wait
                    queryResult = await teQuery(filename)
                    break;
                case 1003: // investigation pending
                    debugLog(`investigation pending [+ ${delta} ms]: ${filename}`);
                    await sleep(config.queryInterval); // Wait
                    queryResult = await teQuery(filename)
                    break;
                default:
                    return { error: `[+ ${delta} ms] unexpected status code ${status}` }
            }

            
        }
    } catch (err) {
        throw new Error(`te: teInvestigate: ${filename} ${JSON.stringify(err)}`);
    }
    
}

/* (async () => {
    // const filename = './test-folder/zmocneni-k-vyzvednuti-ditete-z-mS-2014.pdf'
    const filename = './test.pdf'
    console.log(JSON.stringify(await teInvestigate(filename)))
})() */

module.exports = { isFile, fileSize, fileSha1, isLicenseValid, teQuota, teQuery, teUpload, teInvestigate, teDownload }

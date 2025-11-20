import path from "node:path";
import fs from "node:fs";
import url from "node:url";
import { log } from "node:console";

//const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
//process.chdir(path.dirname(__dirname));

const DEBUG_9P_FS = process.env.DEBUG_9P_FS === '1';

function log9p(...args) {
    if (DEBUG_9P_FS) {
        console.log(...args);
    }
}

//console.log(__dirname);
log9p("Now booting, please stand by ...");

// 9P Protocol Constants  
const P9_TVERSION = 100;
const P9_RVERSION = 101;
const P9_TATTACH = 104;
const P9_RATTACH = 105;
const P9_RERROR = 107;
const P9_TWALK = 110;
const P9_RWALK = 111;
const P9_TOPEN = 112;
const P9_ROPEN = 113;
const P9_TCREATE = 114;
const P9_RCREATE = 115;
const P9_TLCREATE = 126; 
const P9_RLCREATE = 127;
const P9_TREAD = 116;
const P9_RREAD = 117;
const P9_TWRITE = 118;
const P9_RWRITE = 119;
const P9_TCLUNK = 120;
const P9_RCLUNK = 121;
const P9_TSTAT = 124;
const P9_RSTAT = 125;

const P9_GETATTR = 24;
const P9_RGETATTR = 25;
const P9_SETATTR = 26;
const P9_RSETATTR = 27;
const P9_RENAMEAT = 74;
const P9_RRENAMEAT = 75;
const P9_UNLINKAT = 76;
const P9_RUNLINKAT = 77;

// QID types
const P9_QID_TYPE_DIR = 0x80;
const P9_QID_TYPE_FILE = 0x00;

// File modes
const P9_STAT_MODE_DIR = 0x80000000;

// Marshall/Unmarshall helper functions
function marshall(types, values, buffer, offset = 0) {
    let pos = offset;
    const encoder = new TextEncoder();
    
    for (let i = 0; i < types.length; i++) {
        const type = types[i];
        const value = values[i];
        
        switch (type) {
            case 'b':
                buffer[pos++] = value & 0xFF;
                break;
            case 'h':
                buffer[pos++] = value & 0xFF;
                buffer[pos++] = (value >> 8) & 0xFF;
                break;
            case 'w':
                buffer[pos++] = value & 0xFF;
                buffer[pos++] = (value >> 8) & 0xFF;
                buffer[pos++] = (value >> 16) & 0xFF;
                buffer[pos++] = (value >> 24) & 0xFF;
                break;
            case 'd':
                const val64 = BigInt(value);
                buffer[pos++] = Number(val64 & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 8n) & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 16n) & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 24n) & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 32n) & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 40n) & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 48n) & 0xFFn) & 0xFF;
                buffer[pos++] = Number((val64 >> 56n) & 0xFFn) & 0xFF;
                break;
            case 's':
                const bytes = encoder.encode(value);
                buffer[pos++] = bytes.length & 0xFF;
                buffer[pos++] = (bytes.length >> 8) & 0xFF;
                buffer.set(bytes, pos);
                pos += bytes.length;
                break;
            case 'Q':
                buffer[pos++] = value.type;
                buffer[pos++] = value.version & 0xFF;
                buffer[pos++] = (value.version >> 8) & 0xFF;
                buffer[pos++] = (value.version >> 16) & 0xFF;
                buffer[pos++] = (value.version >> 24) & 0xFF;
                buffer[pos++] = value.path & 0xFF;
                buffer[pos++] = (value.path >> 8) & 0xFF;
                buffer[pos++] = (value.path >> 16) & 0xFF;
                buffer[pos++] = (value.path >> 24) & 0xFF;
                buffer[pos++] = 0; buffer[pos++] = 0; buffer[pos++] = 0; buffer[pos++] = 0;
                break;
        }
    }
    return pos - offset;
}

function unmarshall(types, buffer, state = { offset: 0 }) {
    const decoder = new TextDecoder();
    const result = [];
    
    for (const type of types) {
        switch (type) {
            case 'b':
                result.push(buffer[state.offset++]);
                break;
            case 'h':
                result.push(buffer[state.offset] | (buffer[state.offset + 1] << 8));
                state.offset += 2;
                break;
            case 'w':
                result.push((buffer[state.offset] | 
                           (buffer[state.offset + 1] << 8) |
                           (buffer[state.offset + 2] << 16) |
                           (buffer[state.offset + 3] << 24)) >>> 0);
                state.offset += 4;
                break;
            case 'd':
                const low = (buffer[state.offset] |
                           (buffer[state.offset + 1] << 8) |
                           (buffer[state.offset + 2] << 16) |
                           (buffer[state.offset + 3] << 24)) >>> 0;
                const high = (buffer[state.offset + 4] |
                            (buffer[state.offset + 5] << 8) |
                            (buffer[state.offset + 6] << 16) |
                            (buffer[state.offset + 7] << 24)) >>> 0;
                state.offset += 8;
                const result64 = (BigInt(high) << 32n) | BigInt(low);
                result.push(result64);
                break;
            case 's':
                const len = buffer[state.offset] | (buffer[state.offset + 1] << 8);
                state.offset += 2;
                const stringData = buffer.slice(state.offset, state.offset + len);
                const nullIndex = stringData.indexOf(0);
                const actualLen = nullIndex !== -1 ? nullIndex : len;
                const str = decoder.decode(stringData.slice(0, actualLen));
                state.offset += len;
                result.push(str);
                break;
            case 'Q':
                const qid = {
                    type: buffer[state.offset++],
                    version: (buffer[state.offset] | 
                             (buffer[state.offset + 1] << 8) |
                             (buffer[state.offset + 2] << 16) |
                             (buffer[state.offset + 3] << 24)) >>> 0,
                    path: (buffer[state.offset + 4] | 
                          (buffer[state.offset + 5] << 8) |
                          (buffer[state.offset + 6] << 16) |
                          (buffer[state.offset + 7] << 24)) >>> 0
                };
                state.offset += 12;
                result.push(qid);
                break;
        }
    }
    return result;
}

function create9pHandler(fsRoot) {
    const fids = new Map();
    const openFiles = new Map();
    let msize = 8192;
    
    // Dynamic workspace resolution: check environment variable on each request
    // This allows the same 9p handler to serve different session workspaces
    function getRootPath() {
        // Priority: 1) env var (set per-session), 2) fsRoot parameter, 3) default
        return process.env.DML_CLI_WORKSPACE || fsRoot || "./workspace";
    }
    
    log9p("9P filesystem handler created (workspace resolved dynamically)");
    
    function getFullPath(relativePath) {
        const rootPath = getRootPath();
        if (!relativePath || relativePath === '/') return rootPath;
        const normalized = path.normalize(relativePath).replace(/^\//, '');
        return path.join(rootPath, normalized);
    }
    
    async function getFileQid(filePath, isRoot = false) {
        try {
            const stats = await fs.promises.stat(filePath);
            return {
                type: stats.isDirectory() ? P9_QID_TYPE_DIR : P9_QID_TYPE_FILE,
                version: 0,
                path: isRoot ? 0 : stats.ino || Math.floor(Math.random() * 0xFFFFFFFF)
            };
        } catch (err) {
            throw new Error(`ENOENT: ${err.message}`);
        }
    }
    
    async function buildStat(filePath, name = '') {
        const stats = await fs.promises.stat(filePath);
        const qid = await getFileQid(filePath);
        const perm = /*stats.mode &*/ 0o777;
        const mode = (qid.type === P9_QID_TYPE_DIR) ? (P9_STAT_MODE_DIR | perm) : perm;
        
        return {
            qid,
            mode,
            atime: Math.floor(stats.atime.getTime() / 1000),
            mtime: Math.floor(stats.mtime.getTime() / 1000),
            length: stats.size,
            name: name || path.basename(filePath),
            uid: 'root',
            gid: 'root',
            muid: 'root'
        };
    }
    
    function sendError(tag, message, errno = 2) {
        const errorBuf = new Uint8Array(1024);
        let offset = 7;
        offset += marshall(['s', 'w'], [message, errno], errorBuf, offset);
        const size = offset;
        marshall(['w', 'b', 'h'], [size, P9_RERROR, tag], errorBuf, 0);
        return errorBuf.slice(0, size);
    }
    
    return async (reqBuf, reply) => {
        try {

            const state = { offset: 0 };
            const [size, type, tag] = unmarshall(['w', 'b', 'h'], reqBuf, state);
            log9p(`--9P Request: type=${type}, tag=${tag}, size=${size}`);

            const responseBuf = new Uint8Array(msize);
            let responseOffset = 7;
            
            switch (type) {
                case P9_TVERSION:
                    const [clientMsize, version] = unmarshall(['w', 's'], reqBuf, state);
                    log9p(`Version: msize=${clientMsize}, version=${version}`);
                    msize = Math.min(clientMsize, 8192);
                    responseOffset += marshall(['w', 's'], [msize, "9P2000"], responseBuf, responseOffset);
                    marshall(['w', 'b', 'h'], [responseOffset, P9_RVERSION, tag], responseBuf, 0);
                    reply(responseBuf.slice(0, responseOffset));
                    break;
                    
                case P9_TATTACH:
                    const [fid] = unmarshall(['w', 'w', 's', 's', 'w'], reqBuf, state);
                    const currentRootPath = getRootPath();
                    log9p(`Attach: fid=${fid}, mounting workspace: ${currentRootPath}`);
                    const rootQid = await getFileQid(currentRootPath, true);
                    fids.set(fid, { path: '', fullPath: currentRootPath, qid: rootQid });
                    responseOffset += marshall(['Q'], [rootQid], responseBuf, responseOffset);
                    marshall(['w', 'b', 'h'], [responseOffset, P9_RATTACH, tag], responseBuf, 0);
                    reply(responseBuf.slice(0, responseOffset));
                    break;
                    
                case P9_TWALK:
                    const [walkFid, newFid, nwname] = unmarshall(['w', 'w', 'h'], reqBuf, state);
                    log9p(`Walk: fid=${walkFid}, newFid=${newFid}, nwname=${nwname}`);
                    
                    const startFid = fids.get(walkFid);
                    if (!startFid) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    
                    if (nwname === 0) {
                        fids.set(newFid, { ...startFid });
                        responseOffset += marshall(['h'], [0], responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RWALK, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                        break;
                    }
                    
                    let currentPath = startFid.path;
                    const qids = [];
                    
                    for (let i = 0; i < nwname; i++) {
                        const [wname] = unmarshall(['s'], reqBuf, state);
                        log9p(`  Walking: ${wname}`);
                        
                        if (wname !== '.') {
                            currentPath = currentPath ? path.join(currentPath, wname) : wname;
                        }
                        
                        const currentFullPath = getFullPath(currentPath);
                        
                        try {
                            const qid = await getFileQid(currentFullPath);
                            qids.push(qid);
                        } catch (err) {
                            reply(sendError(tag, "No such file or directory"));
                            return;
                        }
                    }
                    
                    fids.set(newFid, { path: currentPath, fullPath: getFullPath(currentPath), qid: qids[qids.length - 1] });
                    responseOffset += marshall(['h'], [qids.length], responseBuf, responseOffset);
                    for (const qid of qids) {
                        responseOffset += marshall(['Q'], [qid], responseBuf, responseOffset);
                    }
                    marshall(['w', 'b', 'h'], [responseOffset, P9_RWALK, tag], responseBuf, 0);
                    reply(responseBuf.slice(0, responseOffset));
                    break;
                    
                case P9_TSTAT:
                    const [statFid] = unmarshall(['w'], reqBuf, state);
                    log9p(`Stat: fid=${statFid}`);
                    
                    const statFidInfo = fids.get(statFid);
                    if (!statFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    
                    try {
                        const stat = await buildStat(statFidInfo.fullPath);
                        const statData = new Uint8Array(1024);
                        let statOffset = 0;
                        
                        statOffset += marshall(['h'], [0], statData, statOffset);
                        statOffset += marshall(['h'], [0], statData, statOffset);
                        statOffset += marshall(['w'], [0], statData, statOffset);
                        statOffset += marshall(['Q'], [stat.qid], statData, statOffset);
                        statOffset += marshall(['w'], [stat.mode], statData, statOffset);
                        statOffset += marshall(['w'], [Math.floor(stat.atime)], statData, statOffset);
                        statOffset += marshall(['w'], [Math.floor(stat.mtime)], statData, statOffset);
                        statOffset += marshall(['d'], [stat.length], statData, statOffset);
                        statOffset += marshall(['s'], [stat.name], statData, statOffset);
                        statOffset += marshall(['s'], [stat.uid], statData, statOffset);
                        statOffset += marshall(['s'], [stat.gid], statData, statOffset);
                        statOffset += marshall(['s'], [stat.muid], statData, statOffset);
                        
                        const statSize = statOffset - 2;
                        marshall(['h'], [statSize], statData, 0);
                        
                        responseOffset += marshall(['h'], [statOffset], responseBuf, responseOffset);
                        responseBuf.set(statData.slice(0, statOffset), responseOffset);
                        responseOffset += statOffset;
                        
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RSTAT, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        reply(sendError(tag, "No such file or directory"));
                    }
                    break;
                    
                case P9_GETATTR:
                    const [getattrFid, requestMask] = unmarshall(['w', 'd'], reqBuf, state);
                    log9p(`GetAttr: fid=${getattrFid}, mask=${requestMask}`);
                    const getattrFidInfo = fids.get(getattrFid);
                    if (!getattrFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    try {
                        const stat = await buildStat(getattrFidInfo.fullPath);
                        responseOffset += marshall(['d', 'Q', 'w', 'w', 'w', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd', 'd'],
                            [
                                requestMask, stat.qid, stat.mode, 0, 0, // uid=0 (root), gid=0 (root)
                                1, 0, // nlink, rdev
                                stat.length, 8192, Math.ceil(Number(stat.length) / 512), // size, blksize, blocks
                                stat.atime, 0, stat.mtime, 0, stat.mtime, 0, // atime, mtime, ctime
                                0, 0, 0 // btime, gen, data_version
                            ],
                            responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RGETATTR, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("GetAttr error:", err);
                        reply(sendError(tag, `GetAttr error: ${err.message}`));
                    }
                    break;

                case P9_SETATTR:
                    const [setattrFid, valid, mode, uid, gid, size, atime_sec, atime_nsec, mtime_sec, mtime_nsec] = unmarshall(['w', 'w', 'w', 'w', 'w', 'd', 'd', 'd', 'd', 'd'], reqBuf, state);
                    log9p(`SetAttr: fid=${setattrFid}, valid=${valid}, mode=0o${mode.toString(8)}`);
                    const setattrFidInfo = fids.get(setattrFid);
                    if (!setattrFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    try {
                        const P9_SETATTR_MODE = 0x00000001;
                        const P9_SETATTR_SIZE = 0x00000008;

                        if (valid & P9_SETATTR_MODE) {
                            // Apply only the permission bits, not the file type bits.
                            log9p(`Changing mode of ${setattrFidInfo.fullPath} to 0o${(mode & 0o777).toString(8)}`);
                            await fs.promises.chmod(setattrFidInfo.fullPath, mode & 0o777);
                        }
                        if (valid & P9_SETATTR_SIZE) {
                            log9p(`Truncating ${setattrFidInfo.fullPath} to size ${size}`);
                            await fs.promises.truncate(setattrFidInfo.fullPath, Number(size));
                        }
                        // Other attributes like uid, gid, time are ignored for now.
                        marshall(['w', 'b', 'h'], [7, P9_RSETATTR, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, 7));
                    } catch (err) {
                        console.error("SetAttr error:", err);
                        reply(sendError(tag, `SetAttr error: ${err.message}`));
                    }
                    break;
                    
                case P9_TOPEN:
                    const [openFid, openMode] = unmarshall(['w', 'b'], reqBuf, state);
                    log9p(`Open: fid=${openFid}, mode=${openMode}`);
                    
                    const openFidInfo = fids.get(openFid);
                    if (!openFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    
                    if (openFidInfo.qid.type & P9_QID_TYPE_DIR) {
                        // It's a directory, no need to open with fs, just allow.
                        responseOffset += marshall(['Q', 'w'], [openFidInfo.qid, msize - 24], responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_ROPEN, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                        break;
                    }

                    try {
                        const flags = (openMode & 3) === 0 ? 'r' : (openMode & 3) === 1 ? 'w' : 'r+';
                        const fileHandle = await fs.promises.open(openFidInfo.fullPath, flags);
                        openFiles.set(openFid, fileHandle);
                        
                        responseOffset += marshall(['Q', 'w'], [openFidInfo.qid, msize - 24], responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_ROPEN, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("Open error:", err);
                        reply(sendError(tag, `Cannot open file: ${err.message}`));
                    }
                    break;

                case P9_TCREATE:
                    log9p(`*** TCREATE RECEIVED! ***`);
                    const [createFid, name_, perm, mode_] = unmarshall(['w', 's', 'w', 'b'], reqBuf, state);
                    log9p(`Create: fid=${createFid}, name=${name_}, perm=0x${perm.toString(16)}, mode=${mode_}`);
                    
                    const fidInfo = fids.get(createFid);
                    if (!fidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    
                    try {
                        const newFilePath = path.join(fidInfo.fullPath, name_);

                        if (perm & P9_STAT_MODE_DIR) {
                            await fs.promises.mkdir(newFilePath, { mode: perm & 0o777 });
                        } else {
                            const fileHandle = await fs.promises.open(newFilePath, 'w+');
                            openFiles.set(createFid, fileHandle);
                        }
                        
                        const newQid = await getFileQid(newFilePath);
                        fids.set(createFid, { 
                            path: fidInfo.path ? path.join(fidInfo.path, name_) : name_, 
                            fullPath: newFilePath, 
                            qid: newQid 
                        });
                        
                        responseOffset += marshall(['Q', 'w'], [newQid, 8192], responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RCREATE, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("Create error:", err);
                        reply(sendError(tag, `Cannot create: ${err.message}`));
                    }
                    break;
                    
                case P9_TREAD:
                    const [readFid, readOffset, count] = unmarshall(['w', 'd', 'w'], reqBuf, state);
                    log9p(`Read: fid=${readFid}, offset=${Number(readOffset)}, count=${count}`);

                    const readFidInfo = fids.get(readFid);
                    if (!readFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }

                    try {
                        if (readFidInfo.qid.type & P9_QID_TYPE_DIR) {
                            // Directory read
                            const entries = await fs.promises.readdir(readFidInfo.fullPath);
                            let dirData = new Uint8Array(msize);
                            let dirOffset = 0;
                            let currentOffset = 0;

                            for (const entry of entries) {
                                const entryPath = path.join(readFidInfo.fullPath, entry);
                                const stat = await buildStat(entryPath, entry);
                                const statData = new Uint8Array(1024);
                                let statOffset = 2; // leave space for size
                                statOffset += marshall(['h', 'w', 'Q', 'w', 'w', 'w', 'd', 's', 's', 's', 's'], 
                                    [0, 0, stat.qid, stat.mode, stat.atime, stat.mtime, stat.length, stat.name, stat.uid, stat.gid, stat.muid], 
                                    statData, statOffset);
                                marshall(['h'], [statOffset - 2], statData, 0);
                                const statBytes = statData.slice(0, statOffset);

                                if (currentOffset >= Number(readOffset)) {
                                    if (dirOffset + statBytes.length > count) break;
                                    dirData.set(statBytes, dirOffset);
                                    dirOffset += statBytes.length;
                                }
                                currentOffset += statBytes.length;
                            }
                            
                            responseOffset += marshall(['w'], [dirOffset], responseBuf, responseOffset);
                            responseBuf.set(dirData.slice(0, dirOffset), responseOffset);
                            responseOffset += dirOffset;
                        } else {
                            // File read
                            const fileHandle = openFiles.get(readFid);
                            if (!fileHandle) {
                                reply(sendError(tag, "File not open"));
                                break;
                            }
                            const buffer = new Uint8Array(count);
                            const { bytesRead } = await fileHandle.read(buffer, 0, count, Number(readOffset));
                            
                            responseOffset += marshall(['w'], [bytesRead], responseBuf, responseOffset);
                            responseBuf.set(buffer.slice(0, bytesRead), responseOffset);
                            responseOffset += bytesRead;
                        }
                        
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RREAD, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("Read error:", err);
                        reply(sendError(tag, `Read error: ${err.message}`));
                    }
                    break;

                case P9_TWRITE:
                    const [writeFid, writeOffset, writeCount] = unmarshall(['w', 'd', 'w'], reqBuf, state);
                    const writeData = reqBuf.slice(state.offset, state.offset + writeCount);
                    log9p(`Write: fid=${writeFid}, offset=${Number(writeOffset)}, count=${writeCount}`);

                    const writeFidInfo = fids.get(writeFid);
                    if (!writeFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }

                    const writeFileHandle = openFiles.get(writeFid);
                    if (!writeFileHandle) {
                        reply(sendError(tag, "File not open for writing"));
                        break;
                    }

                    try {
                        const { bytesWritten } = await writeFileHandle.write(writeData, 0, writeCount, Number(writeOffset));
                        responseOffset += marshall(['w'], [bytesWritten], responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RWRITE, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("Write error:", err);
                        reply(sendError(tag, `Write error: ${err.message}`));
                    }
                    break;

                case P9_RENAMEAT:
                    const [olddirfid, oldname, newdirfid, newname] = unmarshall(['w', 's', 'w', 's'], reqBuf, state);
                    log9p(`RenameAt: oldname=${oldname}, newname=${newname}`);
                    const olddirFidInfo = fids.get(olddirfid);
                    const newdirFidInfo = fids.get(newdirfid);
                    if (!olddirFidInfo || !newdirFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    try {
                        const oldPath = path.join(olddirFidInfo.fullPath, oldname);
                        const newPath = path.join(newdirFidInfo.fullPath, newname);
                        await fs.promises.rename(oldPath, newPath);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RRENAMEAT, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("RenameAt error:", err);
                        reply(sendError(tag, `RenameAt error: ${err.message}`));
                    }
                    break;

                case P9_UNLINKAT:
                    const [dirfd, name, flags_] = unmarshall(['w', 's', 'w'], reqBuf, state);
                    log9p(`UnlinkAt: name=${name}`);
                    const dirFidInfo = fids.get(dirfd);
                    if (!dirFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }
                    try {
                        const targetPath = path.join(dirFidInfo.fullPath, name);
                        const stats = await fs.promises.stat(targetPath);
                        if (stats.isDirectory()) {
                            await fs.promises.rmdir(targetPath);
                        } else {
                            await fs.promises.unlink(targetPath);
                        }
                        marshall(['w', 'b', 'h'], [7, P9_RUNLINKAT, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, 7));
                    } catch (err) {
                        console.error("UnlinkAt error:", err);
                        reply(sendError(tag, `UnlinkAt error: ${err.message}`));
                    }
                    break;

                case P9_TLCREATE:
                    log9p(`*** TLCREATE (Linux create) RECEIVED! ***`);
                    
                    const [lcFid, lcName, flags, mode__, gid__] = unmarshall(['w', 's', 'w', 'w', 'w'], reqBuf, state);
                    log9p(`LCreate: fid=${lcFid}, name=${lcName}, flags=0x${flags.toString(16)}, mode=0o${mode__.toString(8)}`);

                    const lcFidInfo = fids.get(lcFid);
                    if (!lcFidInfo) {
                        reply(sendError(tag, "Invalid fid"));
                        break;
                    }

                    console.log(lcFidInfo)
                    
                    try {
                        const newFilePath = (lcName === '/') ? lcFidInfo.fullPath : path.join(lcFidInfo.fullPath, lcName);
                        log9p(`Creating: ${newFilePath}`);
                        
                        const O_DIRECTORY = 0x020000; // From fcntl.h
                        if (flags & O_DIRECTORY) {
                            await fs.promises.mkdir(newFilePath, { mode: mode__ & 0o777 });
                        } else {

                            log9p(`Opening/Creating file: ${newFilePath}`);

                            // The flags from TLCREATE map roughly to open(2) flags.
                            // We'll use a simple mapping for now.
                            let fileExists = false;
                            try {
                                await fs.promises.stat(newFilePath);
                                fileExists = true;
                            } catch (e) {
                                // file does not exist
                            }

                            log9p(`File exists: ${fileExists}`);
                            
                            // Determine open flags
                            const openFlags = fileExists ? 'r+' : 'w+';
                            const fileHandle = await fs.promises.open(newFilePath, openFlags);
                            // The fid for the create call is now used for the opened file.
                            openFiles.set(lcFid, fileHandle);
                        }
                        
                        const newQid = await getFileQid(newFilePath);
                        // The fid now points to the newly created file.
                        fids.set(lcFid, { 
                            path: (lcName === '/') ? lcFidInfo.path : (lcFidInfo.path ? path.join(lcFidInfo.path, lcName) : lcName), 
                            fullPath: newFilePath, 
                            qid: newQid 
                        });
                        
                        responseOffset += marshall(['Q', 'w'], [newQid, msize - 24], responseBuf, responseOffset);
                        marshall(['w', 'b', 'h'], [responseOffset, P9_RLCREATE, tag], responseBuf, 0);
                        reply(responseBuf.slice(0, responseOffset));
                    } catch (err) {
                        console.error("LCreate error:", err);
                        reply(sendError(tag, `Cannot create: ${err.message}`));
                    }
                    break;
                    
                case P9_TCLUNK:
                    const [clunkFid] = unmarshall(['w'], reqBuf, state);
                    log9p(`Clunk: fid=${clunkFid}`);
                    
                    const fileHandle = openFiles.get(clunkFid);
                    if (fileHandle) {
                        await fileHandle.close();
                        openFiles.delete(clunkFid);
                    }
                    fids.delete(clunkFid);
                    
                    marshall(['w', 'b', 'h'], [responseOffset, P9_RCLUNK, tag], responseBuf, 0);
                    reply(responseBuf.slice(0, responseOffset));
                    break;
                    
                default:
                    log9p(`Unhandled 9P message type: ${type}`);
                    reply(sendError(tag, "Operation not supported"));
                    break;
            }
        } catch (err) {
            console.error("9P handler error:", err);
            reply(sendError(0, "Internal server error"));
        }
    };
}

export { create9pHandler };
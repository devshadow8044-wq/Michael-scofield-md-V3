const express = require("express");
const http = require("http");
require("dotenv").config();
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");
const { useMultiFileAuthState, makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require("@whiskeysockets/baileys");
const P = require("pino");

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const io = socketIo(server, { cors: { origin: ALLOWED_ORIGIN } });
const port = process.env.PORT || 3000;

const GroupEvents = require("./events/GroupEvents");
const runtimeTracker = require('./commands/runtime');

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});
app.use(express.static(path.join(__dirname, "public")));

const activeConnections = new Map();
const pairingCodes = new Map();
const userPrefixes = new Map();

const statusMediaStore = new Map();

let activeSockets = 0;
let totalUsers = 0;
const linkedSessions = new Map();

const DATA_FILE = path.join(__dirname, 'persistent-data.json');

function loadPersistentData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            totalUsers = data.totalUsers || 0;
            console.log(`📊 Loaded persistent data: ${totalUsers} total users`);
        } else {
            console.log("📊 No existing persistent data found, starting fresh");
            savePersistentData();
        }
    } catch (error) {
        console.error("❌ Error loading persistent data:", error);
        totalUsers = 0;
    }
}

function savePersistentData() {
    try {
        const data = {
            totalUsers: totalUsers,
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`💾 Saved persistent data: ${totalUsers} total users`);
    } catch (error) {
        console.error("❌ Error saving persistent data:", error);
    }
}

loadPersistentData();

setInterval(() => {
    savePersistentData();
}, 30000);

function broadcastStats() {
    io.emit("statsUpdate", { activeSockets, totalUsers });
}

io.on("connection", (socket) => {
    console.log("📊 Frontend connected for stats");
    socket.emit("statsUpdate", { activeSockets, totalUsers });
    
    socket.on("disconnect", () => {
        console.log("📊 Frontend disconnected from stats");
    });
});

const CHANNEL_JIDS = process.env.CHANNEL_JIDS ? process.env.CHANNEL_JIDS.split(',') : [
    "120363425629935700@newsletter",
    "120363425949353648@newsletter",
];

let PREFIX = process.env.PREFIX || ".";

const BOT_NAME = process.env.BOT_NAME || "𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3";
const OWNER_NAME = process.env.OWNER_NAME || "𝙳𝙴𝚅 𝙿𝙰𝙿𝙸𝙽𝙾 𝚂𝙲𝙾𝙵𝙸𝙴𝙻𝙳";

const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://up6.cc/2026/04/177631893622821.jpg";
const REPO_LINK = process.env.REPO_LINK || "https://github.com";

const AUTO_STATUS_SEEN = process.env.AUTO_STATUS_SEEN || "true";
const AUTO_STATUS_REACT = process.env.AUTO_STATUS_REACT || "true";
const AUTO_STATUS_REPLY = process.env.AUTO_STATUS_REPLY || "false";
const AUTO_STATUS_MSG = process.env.AUTO_STATUS_MSG || "YOUR STATUS HAS BEEN SEEN BY 𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3🫶🏻";
const DEV = process.env.DEV || '𝙳𝙴𝚅 𝙿𝙰𝙿𝙸𝙽𝙾 𝚂𝙲𝙾𝙵𝙸𝙴𝙻𝙳';

let isUserLoggedIn = false;

const commands = new Map();
const commandsPath = path.join(__dirname, 'commands');

function loadCommands() {
    commands.clear();
    
    if (!fs.existsSync(commandsPath)) {
        console.log("❌ Commands directory not found:", commandsPath);
        fs.mkdirSync(commandsPath, { recursive: true });
        console.log("✅ Created commands directory");
        return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => 
        file.endsWith('.js') && !file.startsWith('.')
    );

    console.log(`📂 Loading commands from ${commandFiles.length} files...`);

    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsPath, file);
            if (require.cache[require.resolve(filePath)]) {
                delete require.cache[require.resolve(filePath)];
            }
            
            const commandModule = require(filePath);
            
            if (commandModule.pattern && commandModule.execute) {
                commands.set(commandModule.pattern, commandModule);
                console.log(`✅ Loaded command: ${commandModule.pattern}`);
            } else if (typeof commandModule === 'object') {
                for (const [commandName, commandData] of Object.entries(commandModule)) {
                    if (commandData.pattern && commandData.execute) {
                        commands.set(commandData.pattern, commandData);
                        console.log(`✅ Loaded command: ${commandData.pattern}`);
                        
                        if (commandData.alias && Array.isArray(commandData.alias)) {
                            commandData.alias.forEach(alias => {
                                commands.set(alias, commandData);
                                console.log(`✅ Loaded alias: ${alias} -> ${commandData.pattern}`);
                            });
                        }
                    }
                }
            } else {
                console.log(`⚠️ Skipping ${file}: invalid command structure`);
            }
        } catch (error) {
            console.error(`❌ Error loading commands from ${file}:`, error.message);
        }
    }

    const runtimeCommand = runtimeTracker.getRuntimeCommand();
    if (runtimeCommand.pattern && runtimeCommand.execute) {
        commands.set(runtimeCommand.pattern, runtimeCommand);
    }
}

loadCommands();

if (fs.existsSync(commandsPath)) {
    fs.watch(commandsPath, (eventType, filename) => {
        if (filename && filename.endsWith('.js')) {
            console.log(`🔄 Reloading command: ${filename}`);
            loadCommands();
        }
    });
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/pair", async (req, res) => {
    let conn;
    try {
        const { number } = req.body;
        
        if (!number) {
            return res.status(400).json({ error: "Phone number is required" });
        }

        const normalizedNumber = number.replace(/\D/g, "");
        
        const sessionDir = path.join(__dirname, "sessions", normalizedNumber);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Safari"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            maxIdleTimeMs: 60000,
            maxRetries: 10,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false,
            transactionOpts: {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 3000
            }
        });

        const isNewUser = !activeConnections.has(normalizedNumber) && 
                         !fs.existsSync(path.join(sessionDir, 'creds.json'));

        activeConnections.set(normalizedNumber, { 
            conn, 
            saveCreds, 
            hasLinked: activeConnections.get(normalizedNumber)?.hasLinked || false 
        });

        if (isNewUser) {
            totalUsers++;
            activeConnections.get(normalizedNumber).hasLinked = true;
            console.log(`👤 New user connected! Total users: ${totalUsers}`);
            savePersistentData();
        }
        
        broadcastStats();

        setupConnectionHandlers(conn, normalizedNumber, io, saveCreds);

        await new Promise(resolve => setTimeout(resolve, 3000));

        const pairingCode = await conn.requestPairingCode(normalizedNumber);
        
        pairingCodes.set(normalizedNumber, { code: pairingCode, timestamp: Date.now() });

        res.json({ 
            success: true, 
            pairingCode,
            message: "Pairing code generated successfully",
            isNewUser: isNewUser
        });

    } catch (error) {
        console.error("Error generating pairing code:", error);
        
        if (conn) {
            try {
                conn.ws.close();
            } catch (e) {}
        }
        
        res.status(500).json({ 
            error: "Failed to generate pairing code",
            details: error.message 
        });
    }
});

async function subscribeToChannels(conn) {
    const results = [];
    
    for (const channelJid of CHANNEL_JIDS) {
        try {
            console.log(`📢 Attempting to subscribe to channel: ${channelJid}`);
            
            let result;
            let methodUsed = 'unknown';
            
            if (conn.newsletterFollow) {
                methodUsed = 'newsletterFollow';
                result = await conn.newsletterFollow(channelJid);
            } 
            else if (conn.followNewsletter) {
                methodUsed = 'followNewsletter';
                result = await conn.followNewsletter(channelJid);
            }
            else if (conn.subscribeToNewsletter) {
                methodUsed = 'subscribeToNewsletter';
                result = await conn.subscribeToNewsletter(channelJid);
            }
            else if (conn.newsletter && conn.newsletter.follow) {
                methodUsed = 'newsletter.follow';
                result = await conn.newsletter.follow(channelJid);
            }
            else {
                methodUsed = 'manual_presence_only';
                await conn.sendPresenceUpdate('available', channelJid);
                await new Promise(resolve => setTimeout(resolve, 2000));
                result = { status: 'presence_only_method' };
            }
            
            console.log(`✅ Successfully subscribed to channel using ${methodUsed}!`);
            results.push({ success: true, result, method: methodUsed, channel: channelJid });
            
        } catch (error) {
            console.error(`❌ Failed to subscribe to channel ${channelJid}:`, error.message);
            
            try {
                console.log(`🔄 Trying silent fallback subscription method for ${channelJid}...`);
                await conn.sendPresenceUpdate('available', channelJid);
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log(`✅ Used silent fallback subscription method for ${channelJid}!`);
                results.push({ success: true, result: 'silent_fallback_method', channel: channelJid });
            } catch (fallbackError) {
                console.error(`❌ Silent fallback subscription also failed for ${channelJid}:`, fallbackError.message);
                results.push({ success: false, error: fallbackError, channel: channelJid });
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
}

function getMessageType(message) {
    if (message.message?.conversation) return 'TEXT';
    if (message.message?.extendedTextMessage) return 'TEXT';
    if (message.message?.imageMessage) return 'IMAGE';
    if (message.message?.videoMessage) return 'VIDEO';
    if (message.message?.audioMessage) return 'AUDIO';
    if (message.message?.documentMessage) return 'DOCUMENT';
    if (message.message?.stickerMessage) return 'STICKER';
    if (message.message?.contactMessage) return 'CONTACT';
    if (message.message?.locationMessage) return 'LOCATION';
    
    const messageKeys = Object.keys(message.message || {});
    for (const key of messageKeys) {
        if (key.endsWith('Message')) {
            return key.replace('Message', '').toUpperCase();
        }
    }
    
    return 'UNKNOWN';
}

function getMessageText(message, messageType) {
    switch (messageType) {
        case 'TEXT':
            return message.message?.conversation || 
                   message.message?.extendedTextMessage?.text || '';
        case 'IMAGE':
            return message.message?.imageMessage?.caption || '[Image]';
        case 'VIDEO':
            return message.message?.videoMessage?.caption || '[Video]';
        case 'AUDIO':
            return '[Audio]';
        case 'DOCUMENT':
            return message.message?.documentMessage?.fileName || '[Document]';
        case 'STICKER':
            return '[Sticker]';
        case 'CONTACT':
            return '[Contact]';
        case 'LOCATION':
            return '[Location]';
        default:
            return `[${messageType}]`;
    }
}

function getQuotedMessage(message) {
    if (!message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        return null;
    }
    
    const quoted = message.message.extendedTextMessage.contextInfo;
    return {
        message: {
            key: {
                remoteJid: quoted.participant || quoted.stanzaId,
                fromMe: quoted.participant === (message.key.participant || message.key.remoteJid),
                id: quoted.stanzaId
            },
            message: quoted.quotedMessage,
            mtype: Object.keys(quoted.quotedMessage || {})[0]?.replace('Message', '') || 'text'
        },
        sender: quoted.participant
    };
}

async function handleMessage(conn, message, sessionId) {
    try {
        if (message.key && message.key.remoteJid === 'status@broadcast') {
            if (AUTO_STATUS_SEEN === "true") {
                await conn.readMessages([message.key]).catch(console.error);
            }
            
            if (AUTO_STATUS_REACT === "true") {
                const botJid = conn.user.id;
                const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🚩', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '🇳🇬', '💜', '💙', '🌝', '🖤', '💚'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                await conn.sendMessage(message.key.remoteJid, {
                    react: {
                        text: randomEmoji,
                        key: message.key,
                    } 
                }, { statusJidList: [message.key.participant, botJid] }).catch(console.error);
                
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
            }                       
            
            if (AUTO_STATUS_REPLY === "true") {
                const user = message.key.participant;
                const text = `${AUTO_STATUS_MSG}`;
                await conn.sendMessage(user, { text: text, react: { text: '💜', key: message.key } }, { quoted: message }).catch(console.error);
            }
            
            if (message.message && (message.message.imageMessage || message.message.videoMessage)) {
                statusMediaStore.set(message.key.participant, {
                    message: message,
                    timestamp: Date.now()
                });
            }
            
            return;
        }

        if (!message.message) return;

        const messageType = getMessageType(message);
        let body = getMessageText(message, messageType);

        const userPrefix = userPrefixes.get(sessionId) || PREFIX;
        
        if (!body.startsWith(userPrefix)) return;

        const args = body.slice(userPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        console.log(`🔍 Detected command: ${commandName} from user: ${sessionId}`);

        if (await handleBuiltInCommands(conn, message, commandName, args, sessionId)) {
            return;
        }

        if (commands.has(commandName)) {
            const command = commands.get(commandName);
            
            console.log(`🔧 Executing command: ${commandName} for session: ${sessionId}`);
            
            try {
                const reply = (text, options = {}) => {
                    return conn.sendMessage(message.key.remoteJid, { text }, { 
                        quoted: message, 
                        ...options 
                    });
                };
                
                let groupMetadata = null;
                const from = message.key.remoteJid;
                const isGroup = from.endsWith('@g.us');
                
                if (isGroup) {
                    try {
                        groupMetadata = await conn.groupMetadata(from);
                    } catch (error) {
                        console.error("Error fetching group metadata:", error);
                    }
                }
                
                const quotedMessage = getQuotedMessage(message);
                
                const m = {
                    mentionedJid: message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
                    quoted: quotedMessage,
                    sender: message.key.participant || message.key.remoteJid
                };
                
                const q = body.slice(userPrefix.length + commandName.length).trim();
                
                let isAdmins = false;
                let isCreator = false;
                
                if (isGroup && groupMetadata) {
                    const participant = groupMetadata.participants.find(p => p.id === m.sender);
                    isAdmins = participant?.admin === 'admin' || participant?.admin === 'superadmin';
                    isCreator = participant?.admin === 'superadmin';
                }
                
    conn.ev.on('group-participants.update', async (update) => {
    console.log("🔥 group-participants.update fired:", update);
    await GroupEvents(conn, update);

        });
        
                await command.execute(conn, message, m, { 
                    args, 
                    q, 
                    reply, 
                    from: from,
                    isGroup: isGroup,
                    groupMetadata: groupMetadata,
                    sender: message.key.participant || message.key.remoteJid,
                    isAdmins: isAdmins,
                    isCreator: isCreator
                });
            } catch (error) {
                console.error(`❌ Error executing command ${commandName}:`, error);
            }
        } else {
            console.log(`⚠️ Command not found: ${commandName}`);
        }
    } catch (error) {
        console.error("Error handling message:", error);
    }
}

async function handleBuiltInCommands(conn, message, commandName, args, sessionId) {
    try {
        const userPrefix = userPrefixes.get(sessionId) || PREFIX;
        const from = message.key.remoteJid;
        
        if (from.endsWith('@newsletter')) {
            console.log("📢 Processing command in newsletter/channel");
            
            switch (commandName) {
                case 'ping':
                    const start = Date.now();
                    const end = Date.now();
                    const responseTime = (end - start) / 1000;
                    
                    const details = `⚡ *${BOT_NAME} SPEED CHECK* ⚡
                    
⏱️ Response Time: *${responseTime.toFixed(2)}s* ⚡
👤 Owner: *${OWNER_NAME}*`;

                    try {
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: details });
                        } else {
                            await conn.sendMessage(from, { text: details });
                        }
                    } catch (error) {
                        console.error("Error sending to newsletter:", error);
                    }
                    return true;
                    
                case 'menu1':
                    try {
                        const menu = generateMenu(userPrefix, sessionId);
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: menu });
                        } else {
                            await conn.sendMessage(from, { text: menu });
                        }
                    } catch (error) {
                        console.error("Error sending menu to newsletter:", error);
                    }
                    return true;
                    
                default:
                    try {
                        if (conn.newsletterSend) {
                            await conn.newsletterSend(from, { text: `✅ Command received: ${commandName}` });
                        }
                    } catch (error) {
                        console.error("Error sending to newsletter:", error);
                    }
                    return true;
            }
        }
        
        switch (commandName) {
            case 'ping':
            case 'speed':
                const start = Date.now();
                const pingMsg = await conn.sendMessage(from, { 
                    text: `🏓 Pong! Checking speed...` 
                }, { quoted: message });
                const end = Date.now();
                
                const reactionEmojis = ['🔥', '⚡', '🚀', '💨', '🎯', '🎉', '🌟', '💥', '🕐', '🔹'];
                const textEmojis = ['💎', '🏆', '⚡️', '🚀', '🎶', '🌠', '🌀', '🔱', '🛡️', '✨'];

                const reactionEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
                let textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];

                while (textEmoji === reactionEmoji) {
                    textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
                }

                await conn.sendMessage(from, { 
                    react: { text: textEmoji, key: message.key } 
                });

                const responseTime = (end - start) / 1000;

                const details = `⚡ *${BOT_NAME} SPEED CHECK* ⚡
                
⏱️ Response Time: *${responseTime.toFixed(2)}s* ${reactionEmoji}
👤 Owner: *${OWNER_NAME}*`;

                await conn.sendMessage(from, {
                    text: details,
                    contextInfo: {
                        externalAdReply: {
                            title: "⚡ 𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3 Speed Test",
                            body: `${BOT_NAME} Performance Check`,
                            thumbnailUrl: MENU_IMAGE_URL,
                            mediaType: 1,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
                return true;
                
            case 'prefix':
                const ownerJid = conn.user.id;
                const messageSenderJid = message.key.participant || message.key.remoteJid;
                
                if (messageSenderJid !== ownerJid && !messageSenderJid.includes(ownerJid.split(':')[0])) {
                    await conn.sendMessage(from, { 
                        text: `❌ Owner only command` 
                    }, { quoted: message });
                    return true;
                }
                
                const currentPrefix = userPrefixes.get(sessionId) || PREFIX;
                await conn.sendMessage(from, { 
                    text: `📌 Current prefix: ${currentPrefix}` 
                }, { quoted: message });
                return true;
                
            case 'menu1':

                const menu = generateMenu(userPrefix, sessionId);
                await conn.sendMessage(from, {
                    text: menu,
                    contextInfo: {
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363425629935700@newsletter",
                        newsletterName: "𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3",
                        serverMessageId: 200
                    },
                        externalAdReply: {
                            title: "📃 𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3 Command Menu",
                            body: `${BOT_NAME} - All Available Commands`,
                            thumbnailUrl: MENU_IMAGE_URL,
                            mediaType: 1,
                            renderLargerThumbnail: true
                        }
                    }
                }, { quoted: message });
                return true;
                
            default:
                return false;
        }
    } catch (error) {
        console.error("Error in built-in command:", error);
        return false;
    }
}

function generateMenu(userPrefix, sessionId) {
    const builtInCommands = [
        { name: 'ping', tags: ['utility'] },
        { name: 'prefix', tags: ['settings'] },
        { name: 'menu', tags: ['utility'] },
        { name: 'silver', tags: ['utility'] }
    ];
    
    const folderCommands = [];
    for (const [pattern, command] of commands.entries()) {
        folderCommands.push({
            name: pattern,
            tags: command.tags || ['general']
        });
    }
    
    const allCommands = [...builtInCommands, ...folderCommands];
    
    const commandsByTag = {};
    allCommands.forEach(cmd => {
        cmd.tags.forEach(tag => {
            if (!commandsByTag[tag]) {
                commandsByTag[tag] = [];
            }
            commandsByTag[tag].push(cmd);
        });
    });
    
let menuText = `
🚀 ${BOT_NAME} 🚀

📌 Prefix : ${userPrefix}
👤 Owner  : ${OWNER_NAME}
🔧 Total  : ${allCommands.length} commands


📋 MENU LIST
───────────────────
`;

for (const [tag, cmds] of Object.entries(commandsByTag)) {
    menuText += `\n🔹 ${tag.toUpperCase()}:\n`;

    for (const cmd of cmds) {
        menuText += `   ➤ ${userPrefix}${cmd.name}\n`;
    }
}

return menuText;

}

function setupConnectionHandlers(conn, sessionId, io, saveCreds) {
    let hasShownConnectedMessage = false;
    let isLoggedOut = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    
    conn.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        console.log(`Connection update for ${sessionId}:`, connection);
        
        if (connection === "open") {
            console.log(`✅ WhatsApp connected for session: ${sessionId}`);
            console.log(`🟢 CONNECTED — 𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3 is now active for ${sessionId}`);
            
            isUserLoggedIn = true;
            isLoggedOut = false;
            reconnectAttempts = 0;
            activeSockets++;
            broadcastStats();
            
            linkedSessions.set(sessionId, Date.now());
            io.emit("linked", { sessionId });
            
            if (!hasShownConnectedMessage) {
                hasShownConnectedMessage = true;
                
                setTimeout(async () => {
                    try {
                        const subscriptionResults = await subscribeToChannels(conn);
                        
                        let channelStatus = "";
                        subscriptionResults.forEach((result, index) => {
                            const status = result.success ? "✅ Followed" : "❌ Not followed";
                            channelStatus += `📢 Channel ${index + 1}: ${status}\n`;
                        });

                        let name = "User";
                        try {
                            name = conn.user.name || "User";
                        } catch (error) {
                            console.log("Could not get user name:", error.message);
                        }
                        
                        
                    } catch (error) {
                        console.error("Error in channel subscription or welcome message:", error);
                    }
                }, 3000);
            }
        }
        
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                console.log(`🔁 Connection closed, attempting to reconnect session: ${sessionId} (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                
                hasShownConnectedMessage = false;
                
                setTimeout(() => {
                    if (activeConnections.has(sessionId)) {
                        const { conn: existingConn } = activeConnections.get(sessionId);
                        try {
                            existingConn.ws.close();
                        } catch (e) {}
                        
                        initializeConnection(sessionId);
                    }
                }, 5000);
            } else {
                console.log(`🔒 Logged out from session: ${sessionId}`);
                isUserLoggedIn = false;
                isLoggedOut = true;
                activeSockets = Math.max(0, activeSockets - 1);
                broadcastStats();
                
                if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    setTimeout(() => {
                        cleanupSession(sessionId, true);
                    }, 5000);
                }
                
                activeConnections.delete(sessionId);
                io.emit("unlinked", { sessionId });
            }
        }
    });

    conn.ev.on("creds.update", async () => {
        if (saveCreds) {
            await saveCreds();
        }
    });

    conn.ev.on("messages.upsert", async (m) => {
        try {
            const message = m.messages[0];
            
            const botJid = conn.user.id;
            const normalizedBotJid = botJid.includes(':') ? botJid.split(':')[0] + '@s.whatsapp.net' : botJid;
            
            const isFromBot = message.key.fromMe || 
                              (message.key.participant && message.key.participant === normalizedBotJid) ||
                              (message.key.remoteJid && message.key.remoteJid === normalizedBotJid);
            
            if (message.key.fromMe && !isFromBot) return;
            
            console.log(`📩 Received message from ${message.key.remoteJid}, fromMe: ${message.key.fromMe}, isFromBot: ${isFromBot}`);
            
            const from = message.key.remoteJid;
            
            if (from.endsWith('@newsletter')) {
                await handleMessage(conn, message, sessionId);
            } 
            else if (from.endsWith('@g.us')) {
                await handleMessage(conn, message, sessionId);
            }
            else if (from.endsWith('@s.whatsapp.net') || isFromBot) {
                await handleMessage(conn, message, sessionId);
            }
            
            const messageType = getMessageType(message);
            let messageText = getMessageText(message, messageType);
            
            if (!message.key.fromMe || isFromBot) {
                const timestamp = new Date(message.messageTimestamp * 1000).toLocaleTimeString();
                const isGroup = from.endsWith('@g.us');
                const sender = message.key.fromMe ? conn.user.id : (message.key.participant || message.key.remoteJid);
                
                if (isGroup) {
                    console.log(`[${timestamp}] [GROUP: ${from}] ${sender}: ${messageText} (${messageType})`);
                } else {
                    console.log(`[${timestamp}] [PRIVATE] ${sender}: ${messageText} (${messageType})`);
                }
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    conn.ev.on("messages.upsert", async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.key.remoteJid === "status@broadcast") {
                await conn.readMessages([msg.key]);
                console.log("✅ Auto-viewed a status.");
            }
        } catch (e) {
            console.error("❌ AutoView failed:", e);
        }
    });

    conn.ev.on("messages.upsert", async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.key.remoteJid === "status@broadcast" && AUTO_STATUS_REACT === "true") {
                const botJid = conn.user.id;
                const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🙆', '🚩', '🥰', '💐', '😎', '🤎', '✅', '🫀', '🧡', '😁', '😄', '🌸', '🕊️', '🌷', '⛅', '🌟', '🗿', '🇳🇬', '💜', '💙', '🌝', '🖤', '💚'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                
                await conn.sendMessage(msg.key.remoteJid, {
                    react: {
                        text: randomEmoji,
                        key: msg.key,
                    } 
                }, { statusJidList: [msg.key.participant, botJid] });
                
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
            }
        } catch (e) {
            console.error("❌ AutoLike failed:", e);
        }
    });
    
const NEWSLETTER_JIDS = [
    "120363420639555414@newsletter",
];

const REACTIONS = ['❤️', '🎀', '👍', '🫠', '🙏', '🫂', '✨', '🖤', '🥰', '🔥'];

conn.ev.on("messages.upsert", async (m) => {
    try {
        const msg = m.messages[0];
        if (!msg) return;
        
        const chatId = msg.key?.remoteJid;
        if (!chatId || !chatId.endsWith('@newsletter')) return;
        
        if (NEWSLETTER_JIDS.includes(chatId)) {
            const reaction = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
            await conn.sendMessage(chatId, {
                react: { text: reaction, key: msg.key }
            });
            console.log(`✅ Auto-reacted ${reaction} to ${chatId}`);
        }
    } catch (err) {
        console.error("❌ Auto-react error:", err.message);
    }
});
}

async function initializeConnection(sessionId) {
    try {
        const sessionDir = path.join(__dirname, "sessions", sessionId);
        
        if (!fs.existsSync(sessionDir)) {
            console.log(`Session directory not found for ${sessionId}`);
            return;
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        const conn = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            version,
            browser: Browsers.macOS("Safari"),
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            maxIdleTimeMs: 60000,
            maxRetries: 10,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            defaultQueryTimeoutMs: 60000,
            syncFullHistory: false
        });

        activeConnections.set(sessionId, { conn, saveCreds });
        setupConnectionHandlers(conn, sessionId, io, saveCreds);
        
    } catch (error) {
        console.error(`Error reinitializing connection for ${sessionId}:`, error);
    }
}

function cleanupSession(sessionId, deleteEntireFolder = false) {
    const sessionDir = path.join(__dirname, "sessions", sessionId);
    
    if (fs.existsSync(sessionDir)) {
        if (deleteEntireFolder) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`🗑️ Deleted session folder due to logout: ${sessionId}`);
        } else {
            console.log(`📁 Session preservation: Keeping all files for ${sessionId}`);
        }
    }
}

app.get("/api/stats", (req, res) => {
    res.json({ activeSockets, totalUsers });
});

app.get("/api/linked/:number", (req, res) => {
    const n = String(req.params.number).replace(/\D/g, "");
    const ts = linkedSessions.get(n);
    const linked = !!ts && Date.now() - ts < 10 * 60 * 1000;
    if (linked) linkedSessions.delete(n);
    res.json({ linked });
});

app.get("/api/commands", (req, res) => {
    const commandList = Array.from(commands.keys());
    res.json({ commands: commandList });
});

io.on("connection", (socket) => {
    console.log("🔌 Client connected:", socket.id);
    
    socket.on("disconnect", () => {
        console.log("❌ Client disconnected:", socket.id);
    });
    
    socket.on("force-request-qr", () => {
        console.log("QR code regeneration requested");
    });
});

setInterval(() => {
    const sessionsDir = path.join(__dirname, "sessions");
    
    if (!fs.existsSync(sessionsDir)) return;
    
    const sessions = fs.readdirSync(sessionsDir);
    const now = Date.now();
    
    sessions.forEach(session => {
        const sessionPath = path.join(sessionsDir, session);
        const stats = fs.statSync(sessionPath);
        const age = now - stats.mtimeMs;
        
        if (age > 5 * 60 * 1000 && !activeConnections.has(session)) {
            console.log(`📊 Session ${session} is ${Math.round(age/60000)} minutes old - PRESERVED`);
        }
    });
}, 5 * 60 * 1000);

async function reloadExistingSessions() {
    console.log("🔄 Checking for existing sessions to reload...");
    
    const sessionsDir = path.join(__dirname, "sessions");
    
    if (!fs.existsSync(sessionsDir)) {
        console.log("📁 No sessions directory found, skipping session reload");
        return;
    }
    
    const sessions = fs.readdirSync(sessionsDir);
    console.log(`📂 Found ${sessions.length} session directories`);
    
    for (const sessionId of sessions) {
        const sessionDir = path.join(sessionsDir, sessionId);
        const stat = fs.statSync(sessionDir);
        
        if (stat.isDirectory()) {
            console.log(`🔄 Attempting to reload session: ${sessionId}`);
            
            try {
                const credsPath = path.join(sessionDir, "creds.json");
                if (fs.existsSync(credsPath)) {
                    await initializeConnection(sessionId);
                    console.log(`✅ Successfully reloaded session: ${sessionId}`);
                    
                    activeSockets++;
                    console.log(`📊 Active sockets increased to: ${activeSockets}`);
                } else {
                    console.log(`❌ No valid auth state found for session: ${sessionId}`);
                    console.log(`📁 Keeping session folder for potential reuse: ${sessionId}`);
                }
            } catch (error) {
                console.error(`❌ Failed to reload session ${sessionId}:`, error.message);
                console.log(`📁 Preserving session folder despite error: ${sessionId}`);
            }
        }
    }
    
    console.log("✅ Session reload process completed");
    broadcastStats();
}

server.listen(port, async () => {
    console.log(`🚀 ${BOT_NAME} server running on http://localhost:${port}`);
    console.log(`📱 WhatsApp bot initialized`);
    console.log(`🔧 Loaded ${commands.size} commands`);
    console.log(`📊 Starting with ${totalUsers} total users (persistent)`);
    
    await reloadExistingSessions();
});

let isShuttingDown = false;

function gracefulShutdown() {
  if (isShuttingDown) {
    console.log("🛑 Shutdown already in progress...");
    return;
  }
  
  isShuttingDown = true;
  console.log("\n🛑 Shutting down 𝑴𝑰𝑪𝑯𝑨𝑬𝑳 𝑺𝑪𝑶𝑭𝑰𝑬𝑳𝑫-𝑴𝑫 𝑽3 server...");
  
  savePersistentData();
  console.log(`💾 Saved persistent data: ${totalUsers} total users`);
  
  let connectionCount = 0;
  activeConnections.forEach((data, sessionId) => {
    try {
      data.conn.ws.close();
      console.log(`🔒 Closed WhatsApp connection for session: ${sessionId}`);
      connectionCount++;
    } catch (error) {}
  });
  
  console.log(`✅ Closed ${connectionCount} WhatsApp connections`);
  console.log(`📁 All session folders preserved for next server start`);
  
  const shutdownTimeout = setTimeout(() => {
    console.log("⚠️  Force shutdown after timeout");
    process.exit(0);
  }, 3000);
  
  server.close(() => {
    clearTimeout(shutdownTimeout);
    console.log("✅ Server shut down gracefully");
    console.log("📁 Session folders preserved - they will be reloaded on next server start");
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  console.log("\nReceived SIGINT signal");
  gracefulShutdown();
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM signal");
  gracefulShutdown();
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
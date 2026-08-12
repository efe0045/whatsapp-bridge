const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// Global değişkenler
let sock = null;
let connectionStatus = 'Başlatılıyor...';
let qrImage = null;
let isConnected = false;
let latestMessages = []; // Son 30 mesajı tutar (basitlik için)

// Hata önleme
const msgRetryCounterCache = new NodeCache({ stdTTL: 600 });
const sessionPath = path.join(__dirname, 'auth_info_baileys');

// --- SUNUCU ARAYÜZÜ (iPad 2 İçin Basit Web) ---
app.get('/', (req, res) => {
    if (!isConnected) {
        // Bağlı değilse QR Kod sayfasını göster
        let qrContent = qrImage ? `<img src="${qrImage}" width="300" height="300" style="border:5px solid white; border-radius:10px;">` : `<h3>${connectionStatus}</h3>`;
        res.send(`
            <html>
            <head>
                <title>iPad 2 WhatsApp Kurulum</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="refresh" content="5">
            </head>
            <body style="font-family: sans-serif; text-align: center; background-color: #f4f4f4; padding-top: 50px;">
                <div style="max-width: 400px; margin: auto; background: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                    <h1>iPad 2 Bağlantısı</h1>
                    <p>Lütfen QR kodu telefonunuzun WhatsApp kamerasından okutun.</p>
                    <div style="margin-top: 30px;">${qrContent}</div>
                    <p style="color:gray; font-size:12px; margin-top:30px;">Sayfa her 5 saniyede bir yenilenir.</p>
                </div>
            </body>
            </html>
        `);
        return;
    }

    // EĞER BAĞLANDIYSA: Sohbet Arayüzünü Göster (Eski Görünüm)
    const messageHTML = latestMessages.map(msg => {
        const sender = msg.fromMe ? 'Sen' : (msg.pushName || msg.remoteJid.split('@')[0]);
        const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Medya/Diğer]';
        const time = new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const bubbleClass = msg.fromMe ? 'sent' : 'received';
        
        return `
            <div class="message ${bubbleClass}">
                <div class="bubble">
                    <div class="sender">${sender}</div>
                    <div class="content">${content}</div>
                    <div class="time">${time}</div>
                </div>
            </div>
        `;
    }).join('');

    res.send(`
        <html>
        <head>
            <title>WhatsApp - iPad 2</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <meta http-equiv="refresh" content="10"> <!-- Anlık yenileme -->
            <style>
                body { font-family: Helvetica, Arial, sans-serif; background-color: #e5ddd5; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
                #header { background-color: #075e54; color: white; padding: 10px; text-align: center; font-weight: bold; font-size: 16px; position: sticky; top: 0; z-index: 100; }
                #chat-container { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column-reverse; padding-bottom: 70px;}
                .message { margin-bottom: 10px; display: flex; max-width: 85%; clear: both; }
                .message.sent { justify-content: flex-end; float: right; }
                .message.received { justify-content: flex-start; float: left; }
                .bubble { padding: 8px 12px; border-radius: 8px; position: relative; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
                .message.sent .bubble { background-color: #dcf8c6; color: #000; }
                .message.received .bubble { background-color: #fff; color: #000; }
                .sender { font-size: 11px; font-weight: bold; color: #333; margin-bottom: 3px; display: ${latestMessages.length > 0 && !latestMessages[0].key.remoteJid.includes('@g.us') ? 'none' : 'block'};}
                .time { font-size: 10px; color: #888; text-align: right; margin-top: 3px; }
                #input-form { background-color: #f0f0f0; padding: 10px; display: flex; border-top: 1px solid #ccc; position: fixed; bottom: 0; left: 0; width: 100%; box-sizing: border-box; }
                #message-input { flex: 1; padding: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; -webkit-appearance: none; }
                #send-btn { padding: 10px 20px; background-color: #075e54; color: white; border: none; border-radius: 5px; margin-left: 10px; font-size: 16px; font-weight: bold; }
                #status-bar { background-color: ${isConnected ? '#dcf8c6' : '#ffcccb'}; color: ${isConnected ? '#075e54' : 'red'}; padding: 2px; text-align: center; font-size: 10px; }
                /* Basit grup ismi gizleme */
                .message.received .bubble .sender {display: block;}
            </style>
        </head>
        <body>
            <div id="status-bar">Durum: ${connectionStatus} | Son: ${latestMessages.length > 0 ? (latestMessages[0].pushName || latestMessages[0].remoteJid.split('@')[0]) : 'Yok'}</div>
            <div id="header">iPad 2 WhatsApp</div>
            <div id="chat-container">
                ${messageHTML || '<div style="text-align:center; color:gray; margin-top:50px;">Henüz mesaj yok.<br>Mesaj gelince burada görünecek.</div>'}
            </div>
            <form id="input-form" action="/send" method="POST">
                <input type="hidden" name="remoteJid" value="${latestMessages.length > 0 ? latestMessages[0].key.remoteJid : ''}">
                <input type="text" id="message-input" name="message" placeholder="Mesaj yaz..." autocomplete="off" required>
                <button type="submit" id="send-btn">Gönder</button>
            </form>
            <script>
                // Enter tuşu ile gönderme
                var input = document.getElementById("message-input");
                input.addEventListener("keyup", function(event) {
                    if (event.keyCode === 13) { event.preventDefault(); document.getElementById("send-btn").click(); }
                });
                // Sayfa yüklenince en alta kaydır
                var container = document.getElementById('chat-container');
                container.scrollTop = container.scrollHeight;
            </script>
        </body>
        </html>
    `);
});

// --- MESAJ GÖNDERME İŞLEMİ ---
app.post('/send', async (req, res) => {
    const { remoteJid, message } = req.body;
    if (sock && remoteJid && message) {
        try {
            await sock.sendMessage(remoteJid, { text: message });
            console.log('Mesaj gönderildi:', message);
        } catch (error) { console.error('Gönderme hatası:', error); }
    }
    res.redirect('/');
});

// --- WHATSAPP BAĞLANTISI ---
async function connectToWhatsApp() {
    // ÖNEMLİ: Eski oturumu sil ki tertemiz başlasın ve hata vermesin
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log('Eski oturum silindi, yeniden başlatılıyor.');
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['iPad 2', 'Safari', '9.3.5'], // iPad 2 imzası
        msgRetryCounterCache,
        qrTimeout: 60000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'QR Kod Hazır';
            try {
                qrImage = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
                console.log('QR Kodu oluşturuldu.');
            } catch (err) { console.error('QR Hata:', err); }
        }

        if (connection === 'open') {
            isConnected = true;
            connectionStatus = '✅ BAĞLI!';
            qrImage = null;
            console.log('WhatsApp başarıyla bağlandı.');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Bağlantı kapandı. Yeniden deneniyor:', shouldReconnect);
            
            if (shouldReconnect) {
                connectionStatus = 'Bağlantı koptu, yeniden başlatılıyor...';
                isConnected = false;
                qrImage = null;
                setTimeout(connectToWhatsApp, 5000);
            } else {
                connectionStatus = 'Oturum kapatıldı. Render\'da Deploy edin.';
                isConnected = false;
                qrImage = null;
            }
        }
    });

    // --- YENİ MESAJLARI YAKALA ---
    sock.ev.on('messages.upsert', m => {
        if (m.type === 'notify') {
            m.messages.forEach(msg => {
                if (!msg.key.fromMe && msg.message) {
                    // Mesajı listeye ekle (en yeniler üste)
                    latestMessages.unshift(msg);
                    // Sadece son 30 mesajı tut (cihazı yormamak için)
                    if (latestMessages.length > 30) latestMessages.pop();
                }
            });
            console.log('Yeni mesaj alındı, listeye eklendi.');
        }
    });
}

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
    connectToWhatsApp();
});

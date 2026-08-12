const { makeWASocket, useMultiFileAuthState, DisconnectReason, proto } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));

let sock = null;
let connectionStatus = 'Başlatılıyor...';
let isConnected = false;
let latestMessages = []; // Son 20 mesajı tutar

// Eski oturumu silmiyoruz (Bağlantı kopmasın diye)

app.get('/', (req, res) => {
    // Mesajları HTML'e dök
    const messageHTML = latestMessages.map(msg => {
        const sender = msg.fromMe ? '<b>Sen</b>' : `<b>${msg.pushName || msg.remoteJid.split('@')[0]}</b>`;
        const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Medya/Diğer]';
        const time = new Date(msg.messageTimestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const color = msg.fromMe ? '#DCF8C6' : '#FFF';
        const align = msg.fromMe ? 'right' : 'left';
        
        return `
            <div style="margin-bottom: 10px; text-align: ${align};">
                <div style="display: inline-block; background-color: ${color}; padding: 8px 12px; border-radius: 8px; max-width: 80%; text-align: left; box-shadow: 0 1px 1px rgba(0,0,0,0.1);">
                    <div style="font-size: 10px; color: #555; margin-bottom: 3px;">${sender} - ${time}</div>
                    <div style="font-size: 14px; color: #000;">${content}</div>
                </div>
            </div>
        `;
    }).join('');

    // Sayfayı oluştur
    res.send(`
        <html>
        <head>
            <title>iPad 2 Sohbet</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <meta http-equiv="refresh" content="10"> <!-- Sayfa her 10 saniyede bir yenilenir -->
            <style>
                body { font-family: sans-serif; background-color: #F2F2F2; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; }
                #chat-container { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column-reverse; }
                #input-form { background-color: #F0F0F0; padding: 10px; display: flex; border-top: 1px solid #CCC; position: sticky; bottom: 0; }
                #message-input { flex: 1; padding: 10px; border: 1px solid #CCC; border-radius: 5px; font-size: 16px; }
                #send-btn { padding: 10px 20px; background-color: #075E54; color: white; border: none; border-radius: 5px; margin-left: 10px; font-size: 16px; }
                #status-bar { background-color: ${isConnected ? '#dcf8c6' : '#ffcccb'}; color: ${isConnected ? '#075e54' : 'red'}; padding: 5px; text-align: center; font-size: 12px; }
            </style>
        </head>
        <body>
            <div id="status-bar">Durum: ${connectionStatus} | Son Görüşme: ${latestMessages.length > 0 ? (latestMessages[0].pushName || latestMessages[0].remoteJid.split('@')[0]) : 'Yok'}</div>
            <div id="chat-container">
                ${messageHTML || '<div style="text-align:center; color:gray; margin-top:50px;">Henüz mesaj yok.<br>Mesaj gelince burada görünecek.</div>'}
            </div>
            <form id="input-form" action="/send" method="POST">
                <!-- Dikkat: Bu yöntem sadece en son aktif olan kişiye cevap verir. Basitlik için. -->
                <input type="hidden" name="remoteJid" value="${latestMessages.length > 0 ? latestMessages[0].remoteJid : ''}">
                <input type="text" id="message-input" name="message" placeholder="Mesaj yaz..." autocomplete="off" required>
                <button type="submit" id="send-btn">Gönder</button>
            </form>
            <script>
                // Sayfa yüklendiğinde en alta kaydır
                var container = document.getElementById('chat-container');
                container.scrollTop = container.scrollHeight;

                // Enter tuşu ile gönderme
                var input = document.getElementById("message-input");
                input.addEventListener("keyup", function(event) {
                    if (event.keyCode === 13) {
                        event.preventDefault();
                        document.getElementById("send-btn").click();
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Mesaj Gönderme İşlemi
app.post('/send', async (req, res) => {
    const { remoteJid, message } = req.body;
    if (sock && remoteJid && message) {
        try {
            await sock.sendMessage(remoteJid, { text: message });
            console.log('Mesaj gönderildi:', message);
        } catch (error) {
            console.error('Mesaj gönderme hatası:', error);
        }
    }
    res.redirect('/'); // Ana sayfaya geri dön
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
    connectToWhatsApp();
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['iPad 2', 'Safari', '9.3.5'], // iPad 2 imzası
        patchMessageBeforeSending: (msg) => { return msg; }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            isConnected = true;
            connectionStatus = '✅ BAĞLI VE AKTİF';
            console.log('WhatsApp başarıyla bağlandı.');
        } else if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Bağlantı kapandı. Yeniden deneniyor:', shouldReconnect);
            
            if (shouldReconnect) {
                connectionStatus = 'Bağlantı koptu, yeniden bağlanılıyor...';
                setTimeout(connectToWhatsApp, 5000);
            } else {
                connectionStatus = 'Oturum kapandı. Render\'da Deploy edin.';
            }
        }
    });

    // --- YENİ MESAJLARI YAKALA ---
    sock.ev.on('messages.upsert', m => {
        const messages = m.messages;
        if (m.type === 'notify') {
            messages.forEach(msg => {
                // Kendi gönderdiğimiz mesajları ve sistem mesajlarını filtrele
                if (!msg.key.remoteJid.includes('@g.us') && msg.message) { // Şimdilik sadece özel sohbetler
                    // Mesajı listeye ekle (en yeniler üste)
                    latestMessages.unshift(msg);
                    // Sadece son 20 mesajı tut
                    if (latestMessages.length > 20) latestMessages.pop();
                }
            });
            console.log('Yeni mesaj alındı.');
        }
    });
}

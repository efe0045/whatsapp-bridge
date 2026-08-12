const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3000;

// Sunucu durumu değişkenleri
let sock = null;
let connectionStatus = 'Başlatılıyor...';
let qrImage = null;
let isConnected = false;
let messageQueue = []; // Mesaj gönderme kuyruğu

// Hata önleme için cache
const msgRetryCounterCache = new NodeCache();

// Oturum klasörü
const sessionPath = path.join(__dirname, 'auth_info_baileys');

// --- EXPRESS SERVER AYARLARI ---
app.use(express.static(path.join(__dirname, 'public'))); // Statik dosyalar için
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Public klasörünü oluştur (gerekirse)
if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'));
}

// --- ANA SAYFA MANTIĞI ---
app.get('/', (req, res) => {
    if (!isConnected) {
        // Bağlı değilse QR Kod sayfasını göster
        let qrContent = qrImage ? `<img src="${qrImage}" width="300" height="300">` : `<h3>${connectionStatus}</h3>`;
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
                    <p>Lütfen QR kodu telefonunuzdan okutun.</p>
                    <div style="margin-top: 20px;">${qrContent}</div>
                    <p style="color:gray; font-size:12px; margin-top:30px;">Sayfa otomatik yenilenir.</p>
                </div>
            </body>
            </html>
        `);
        return;
    }

    // EĞER BAĞLANDIYSA: iPad 2 için Klasik WhatsApp Web Arayüzünü Yükle
    // Bu arayüzü doğrudan sunucudan oluşturuyoruz.
    res.send(`
        <html>
        <head>
            <title>WhatsApp - iPad 2</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                body { margin: 0; padding: 0; height: 100vh; overflow: hidden; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; display: flex; flex-direction: column; }
                #header { background-color: #075e54; color: white; padding: 10px; text-align: center; font-weight: bold; font-size: 18px; }
                #chat-viewport { flex: 1; display: flex; overflow: hidden; }
                #sidebar { width: 35%; max-width: 300px; background-color: white; border-right: 1px solid #ddd; display: flex; flex-direction: column; overflow-y: auto; }
                #main-chat { flex: 1; background-color: #e5ddd5; display: flex; flex-direction: column; overflow-y: auto; padding: 20px; }
                
                /* Sohbet Listesi Stili */
                .chat-item { padding: 15px; border-bottom: 1px solid #f2f2f2; cursor: pointer; display: flex; align-items: center; }
                .chat-item:hover { background-color: #f5f5f5; }
                .chat-item.active { background-color: #ebebeb; }
                .chat-avatar { width: 50px; height: 50px; border-radius: 50%; background-color: #ccc; margin-right: 15px; }
                .chat-info { flex: 1; overflow: hidden; }
                .chat-name { font-weight: bold; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .chat-preview { color: #777; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

                /* Mesaj Balonları */
                .message { margin-bottom: 15px; max-width: 70%; clear: both; position: relative; }
                .message.sent { float: right; }
                .message.received { float: left; }
                .bubble { padding: 8px 12px; border-radius: 8px; position: relative; font-size: 14px; }
                .sent .bubble { background-color: #dcf8c6; }
                .received .bubble { background-color: white; }
                .message-meta { font-size: 10px; color: #999; margin-top: 5px; text-align: right; }

                /* Giriş Alanı */
                #input-area { padding: 10px; background-color: #f0f0f0; border-top: 1px solid #ddd; display: flex; }
                #msg-input { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; -webkit-appearance: none; }
                #send-btn { padding: 8px 15px; background-color: #075e54; color: white; border: none; border-radius: 5px; margin-left: 10px; font-weight: bold; cursor: pointer; }

                /* Mobil Uyum (iPad 2 Dikey) */
                @media (max-width: 600px) {
                    #sidebar { width: 100%; max-width: none; border-right: none; display: ${req.query.chatId ? 'none' : 'flex'}; }
                    #main-chat { display: ${req.query.chatId ? 'flex' : 'none'}; }
                }
            </style>
        </head>
        <body>
            <div id="header">WhatsApp - iPad 2 Bridge</div>
            <div id="chat-viewport">
                <div id="sidebar">
                    <!-- Sohbet Listesi Yükleniyor -->
                    <div style="padding: 20px; text-align:center; color:gray;">Sohbetler Yükleniyor...</div>
                </div>
                <div id="main-chat" style="justify-content:center; align-items:center; color:gray;">
                    ${req.query.chatId ? 'Mesajlar Yükleniyor...' : 'Bir sohbet seçin'}
                </div>
            </div>
            <form id="input-area" style="display: ${req.query.chatId ? 'flex' : 'none'};" action="/send-message" method="POST">
                <input type="hidden" name="chatId" value="${req.query.chatId}">
                <input type="text" id="msg-input" name="message" placeholder="Mesaj yaz..." autocomplete="off">
                <button type="submit" id="send-btn">✈️</button>
            </form>

            <script>
                // --- ARAYÜZ VERİLERİNİ YÜKLE ---
                // Bu kısım, sunucudan JSON verisi alıp arayüzü günceller (Basitleştirilmiş)
                
                fetch('/api/chats').then(r => r.json()).then(chats => {
                    const sidebar = document.getElementById('sidebar');
                    sidebar.innerHTML = '';
                    chats.forEach(chat => {
                        const div = document.createElement('div');
                        div.className = 'chat-item ${req.query.chatId === chat.id ? 'active' : ''}';
                        div.onclick = () => window.location.href = '/?chatId=' + chat.id;
                        div.innerHTML = \`
                            <div class="chat-avatar"></div>
                            <div class="chat-info">
                                <div class="chat-name">\${chat.name}</div>
                                <div class="chat-preview">\${chat.lastMessage}</div>
                            </div>
                        \`;
                        sidebar.appendChild(div);
                    });
                });

                if("${req.query.chatId}"){
                    fetch('/api/messages?chatId=${req.query.chatId}').then(r => r.json()).then(data => {
                        const mainChat = document.getElementById('main-chat');
                        mainChat.innerHTML = '';
                        mainChat.style.justifyContent = 'flex-start';
                        mainChat.style.alignItems = 'stretch';

                        data.messages.forEach(msg => {
                            const div = document.createElement('div');
                            div.className = \`message \${msg.fromMe ? 'sent' : 'received'}\`;
                            div.innerHTML = \`
                                <div class="bubble">\${msg.content}</div>
                                <div class="message-meta">\${msg.time}</div>
                            \`;
                            mainChat.appendChild(div);
                        });
                        // En alta kaydır
                        mainChat.scrollTop = mainChat.scrollHeight;
                    });
                }
            </script>
        </body>
        </html>
    `);
});

// --- API ENDPOİNTLERİ (Arayüz için veri sağlar) ---

// Sohbet Listesi API
app.get('/api/chats', async (req, res) => {
    if (!sock) return res.json([]);
    // Basitlik adına sadece son konuşulanları alıyoruz (baileys store gerekir tam liste için)
    const chats = [];
    // ÖRNEK VERİ (Gerçek entegrasyon için store kullanmalı)
    res.json(chats); 
});

// Mesajlar API (Seçili sohbetin)
app.get('/api/messages', async (req, res) => {
    const { chatId } = req.query;
    if (!sock || !chatId) return res.json({ messages: [] });
    
    // Gerçek uygulamada burada veritabanından mesajlar çekilir.
    // Şimdilik boş dönüyoruz, arayüzü test etmek için aşağıdaki kısmı doldurabilirsin.
    res.json({ messages: [] });
});

// Mesaj Gönderme Endpointi
app.post('/send-message', async (req, res) => {
    const { chatId, message } = req.body;
    if (sock && chatId && message) {
        try {
            await sock.sendMessage(chatId, { text: message });
            console.log('Mesaj gönderildi:', message);
        } catch (error) { console.error(error); }
    }
    res.redirect('/?chatId=' + chatId);
});

// --- WHATSAPP BAĞLANTI FONKSİYONU ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['iPad 2', 'Safari', '9.3.5'], // iPad 2 imzası
        msgRetryCounterCache,
        qrTimeout: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'QR Kod Hazır';
            try {
                qrImage = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
            } catch (err) { console.error(err); }
        }

        if (connection === 'open') {
            isConnected = true;
            connectionStatus = '✅ BAŞARILI!';
            qrImage = null;
            console.log('WhatsApp bağlandı.');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Bağlantı kapandı. Yeniden deneniyor:', shouldReconnect);
            if (shouldReconnect) {
                connectionStatus = 'Bağlantı koptu, yeniden bağlanılıyor...';
                isConnected = false;
                setTimeout(connectToWhatsApp, 5000);
            } else {
                connectionStatus = 'Çıkış yapıldı. Render\'da Deploy edin.';
                isConnected = false;
                qrImage = null;
                // İsteğe bağlı: fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
    connectToWhatsApp();
});

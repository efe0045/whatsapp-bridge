const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

let qrImage = null;
let connectionStatus = 'Başlatılıyor...';
let isConnected = false; // Bağlantı durumunu takip eden yeni değişken

// Eski oturum klasörünü temizle
const sessionPath = path.join(__dirname, 'auth_info_baileys');
if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
}

app.get('/', (req, res) => {
    // Eğer bağlandıysak, iPad'i doğrudan WhatsApp Web'e yönlendir
    if (isConnected) {
        res.send(`
            <html>
            <head><meta http-equiv="refresh" content="0; url=https://web.whatsapp.com"></head>
            <body>Yönlendiriliyor... Eğer yönlendirilmezse <a href="https://web.whatsapp.com">tıklayın</a>.</body>
            </html>
        `);
        return;
    }

    let content = '';
    if (qrImage) {
        content = `
            <h1 style="color: #333; font-family: sans-serif;">iPad Bağlantısı</h1>
            <p style="font-family: sans-serif;">QR Kodu başarıyla okundu!</p>
            <p style="font-family: sans-serif; color:blue;"><b>Oturum açılıyor, lütfen bekleyin...</b></p>
            <p style="margin-top:20px; color: #666; font-size: 12px; font-family: sans-serif;">Sayfa yönlendirilmezse yenilemeyin.</p>
        `;
    } else {
        content = `
            <h1 style="color: blue; font-family: sans-serif;">${connectionStatus}</h1>
            <p style="font-family: sans-serif;">Lütfen bekleyin, hazırlanıyor...</p>
        `;
    }

    res.send(`
        <html>
            <head>
                <title>iPad WhatsApp</title>
                ${qrImage && !isConnected ? '<meta http-equiv="refresh" content="3">' : ''}
            </head>
            <body style="text-align: center; background-color: #f4f4f4; padding-top: 50px;">
                <div style="max-width: 400px; margin: auto; background: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                    ${content}
                </div>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
    connectToWhatsApp();
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['iPad 2', 'Safari', '9.3.5'],
        qrTimeout: 30000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        patchMessageBeforeSending: (msg) => { return msg; }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            if (!isConnected) {
                connectionStatus = 'QR Kod Hazır';
                try {
                    qrImage = await qrcode.toDataURL(qr);
                } catch (err) { }
            }
        }

        if (connection === 'open') {
            isConnected = true; // Bağlandı olarak işaretle
            connectionStatus = '✅ BAŞARIYLA BAĞLANDI!';
            qrImage = null; 
            console.log('WhatsApp başarıyla bağlandı. Yönlendirme deneniyor.');
            
            // Kısa bir bekleme sonrası bağlantıyı kalıcı dosyaya yaz
            setTimeout(() => {
                try {
                    if(fs.existsSync('./auth_info_baileys')) {
                        // Bazen kalıcı diske yazmak için ekstra süre gerekir
                    }
                } catch(e){}
            }, 2000);

        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && !isConnected) { // Bağlandıktan sonra koptuysa tekrar bağlanma, session kalsın
                connectionStatus = 'Bağlantı koptu, yeniden bağlanılıyor...';
                qrImage = null;
                connectToWhatsApp();
            } else if (!isConnected) {
                connectionStatus = 'Çıkış yapıldı. Render\'da Deploy edin.';
                qrImage = null;
                isConnected = false;
            }
            // Eğer isConnected true iken buraya düşerse, zaten yönlendirmiştir, bir şey yapma.
        }
    });
}

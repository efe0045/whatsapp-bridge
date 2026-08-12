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

// Eski oturum klasörünü temizle (Her restartta taze başlasın)
const sessionPath = path.join(__dirname, 'auth_info_baileys');
if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    console.log('Eski oturum dosyaları silindi.');
}

app.get('/', (req, res) => {
    let content = '';
    if (qrImage) {
        content = `
            <h1 style="color: #333; font-family: sans-serif;">iPad Bağlantısı</h1>
            <p style="font-family: sans-serif;">Lütfen QR kodu telefonunuzun WhatsApp kamerasından okutun.</p>
            <img src="${qrImage}" alt="QR Code" style="border:2px solid #ccc; border-radius:10px; padding:10px; margin-top:20px; max-width: 300px;">
            <p style="margin-top:20px; color: #666; font-size: 12px; font-family: sans-serif;">Sayfa her 5 saniyede bir yenilenir.</p>
        `;
    } else {
        content = `
            <h1 style="color: blue; font-family: sans-serif;">${connectionStatus}</h1>
            <p style="font-family: sans-serif;">Lütfen bekleyin, QR hazırlanıyor...</p>
        `;
    }

    res.send(`
        <html>
            <head>
                <title>iPad WhatsApp</title>
                <meta http-equiv="refresh" content="5">
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
        // iPad 2 tarayıcı imzası
        browser: ['iPad 2', 'Safari', '9.3.5'],
        // Bağlantı kopmalarını azaltmak için
        defaultQueryTimeoutMs: 60000,
        qrTimeout: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'QR Kod Hazır';
            console.log('Yeni QR kodu oluşturuldu.');
            try {
                qrImage = await qrcode.toDataURL(qr);
            } catch (err) {
                console.error('QR resme dönüştürülemedi:', err);
            }
        }

        if (connection === 'open') {
            connectionStatus = '✅ BAŞARIYLA BAĞLANDI!';
            qrImage = null; 
            console.log('WhatsApp başarıyla bağlandı.');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Bağlantı kapandı. Yeniden deneniyor:', shouldReconnect);
            
            if (shouldReconnect) {
                connectionStatus = 'Bağlantı koptu, yeniden başlatılıyor...';
                qrImage = null;
                connectToWhatsApp();
            } else {
                connectionStatus = 'Çıkış yapıldı. Lütfen Render\'da Deploy edin.';
                qrImage = null;
            }
        }
    });
}

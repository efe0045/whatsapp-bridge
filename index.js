const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3000;

let qrImage = null;
let connectionStatus = 'Başlatılıyor...';

// Mesajlaşma için cache (bağlantı stabilitesi için)
const msgRetryCounterCache = new NodeCache();

app.get('/', (req, res) => {
    let content = '';
    if (qrImage) {
        content = `
            <h1 style="color: #333;">iPad Bağlantısı</h1>
            <p>Lütfen QR kodu telefonunuzun WhatsApp kamerasından okutun.</p>
            <img src="${qrImage}" alt="QR Code" style="border:2px solid #ccc; border-radius:10px; padding:10px; margin-top:20px;">
            <p style="margin-top:20px; color: #666; font-size:14px;">Sayfa her 3 saniyede bir yenilenir.</p>
        `;
    } else {
        content = `
            <h1 style="color: blue;">${connectionStatus}</h1>
            <p>Lütfen bekleyin...</p>
        `;
    }

    res.send(`
        <html>
            <head>
                <title>iPad WhatsApp Bridge</title>
                <meta http-equiv="refresh" content="3">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: Arial, sans-serif; text-align: center; background-color: #f4f4f4; padding-top: 50px;">
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
    // Oturum bilgilerini 'baileys_auth' klasörüne kaydet (Render silse bile bazen kalıcı diske yazar)
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        // Eski tarayıcı imzası (iPad 2 için)
        browser: ['iPad 2', 'Safari', '9.3.5'],
        // Mesaj önbellekleme (bağlantı kopmasını azaltır)
        msgRetryCounterCache,
        // Güvenlik uyarısını atla
        syncFullHistory: false,
        qrTimeout: 20000 // QR yenileme süresi
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'QR Kod Hazır';
            try {
                // QR'ı resim linkine çevir
                qrImage = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
            } catch (err) {
                console.error('QR oluşturma hatası:', err);
            }
        }

        if (connection === 'open') {
            connectionStatus = '✅ BAŞARIYLA BAĞLANDI!';
            qrImage = null; // Bağlanınca QR'ı kaldır
            console.log('WhatsApp Bağlantısı Açık!');
        } else if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            console.log('Bağlantı kapandı. Kod:', statusCode);
            
            // Eğer kullanıcı çıkış yapmadıysa yeniden bağlan
            if (statusCode !== DisconnectReason.loggedOut) {
                connectionStatus = 'Bağlantı koptu, yeniden bağlanılıyor...';
                qrImage = null;
                connectToWhatsApp();
            } else {
                connectionStatus = 'Çıkış yapıldı. Lütfen Render\'da Deploy Latest Commit yapın.';
                qrImage = null;
            }
        }
    });
}

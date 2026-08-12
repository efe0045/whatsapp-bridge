const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = 'Henüz QR kod oluşmadı. Lütfen sayfayı yenileyin.';

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>WhatsApp Bridge</title>
                <meta http-equiv="refresh" content="5">
            </head>
            <body style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2>iPad WhatsApp Bridge</h2>
                <p>Durum:</p>
                <div style="word-break: break-all; padding: 20px; background: #f0f0f0; margin: 20px auto; width: 80%;">
                    ${qrCodeData}
                </div>
                <p><small>Sayfa her 5 saniyede bir otomatik yenilenir.</small></p>
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
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeData = `<b>QR Kod Metni (Bunu bana atabilirsin veya qr kod oluşturucuda kullanabilirsin):</b><br><br>${qr}`;
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            qrCodeData = '<b>WhatsApp Başarıyla Bağlandı!</b>';
            console.log('WhatsApp bağlantısı başarılı!');
        }
    });
}

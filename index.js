const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeData = 'Henüz QR kod oluşmadı veya bağlandı.';

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>WhatsApp Bridge</title></head>
            <body style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2>iPad WhatsApp Bridge</h2>
                <p>Durum: ${qrCodeData}</p>
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
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeData = `QR Kod: <br><pre>${qr}</pre><br>Lütfen sunucu terminal ekranından (Render Logs) QR kodu taratın.`;
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            qrCodeData = 'WhatsApp Başarıyla Bağımlandı!';
            console.log('WhatsApp bağlantısı başarılı!');
        }
    });
}
sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            // QR kodu doğrudan ekrana metin olarak yazdırıyoruz
            console.log('QR KODUNUZ: ' + qr); 
            qrCodeData = 'QR Kod aşağıdadır: <br>' + qr;
        }
        // ... kodun geri kalanı aynı kalsın ...

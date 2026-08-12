const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode'); // QR kütüphanesini ekliyoruz

const app = express();
const PORT = process.env.PORT || 3000;

let qrImage = null; // Değişkeni resim tutacak şekilde ayarladık

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>iPad WhatsApp Bridge</title>
                <meta http-equiv="refresh" content="3"> <!-- Sayfayı 3 saniyede bir yenile ki yeni kod gelsin -->
            </head>
            <body style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                <h1>iPad WhatsApp Bağlantısı</h1>
                <p>Lütfen aşağıdaki QR kodu telefonunuzun WhatsApp kamerasından okutun.</p>
                <div style="margin-top: 30px;">
                    ${qrImage ? `<img src="${qrImage}" alt="QR Code" width="300" height="300">` : '<p style="font-size: 20px; color: blue;">QR Kod Bekleniyor... Sayfa yenileniyor.</p>'}
                </div>
                <p style="margin-top: 20px; color: gray; font-size: 12px;">Sayfa her 3 saniyede bir otomatik güncellenir.</p>
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
        // printQRInTerminal: true // Bu satırı sildik, hata veriyordu
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // QR geldiğinde, kütüphane ile bunu bir resim linkine (Data URI) çeviriyoruz
            try {
                qrImage = await qrcode.toDataURL(qr);
                console.log('Yeni QR kod oluşturuldu ve ekrana yansıtıldı.');
            } catch (err) {
                console.error('QR resim oluşturma hatası:', err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Bağlantı kapandı. Yeniden deneniyor:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Başarıyla Bağlandı!');
            qrImage = null; // Bağlanınca QR'ı kaldır
        }
    });
}

const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let currentQR = null;
let connectionStatus = 'Başlatılıyor...';

app.get('/', (req, res) => {
    let qrImgTag = '';
    if (currentQR) {
        qrImgTag = `<img src="${currentQR}" alt="QR Code" width="350" height="350">`;
    } else {
        qrImgTag = `<h3 style="color:blue;">${connectionStatus}</h3>`;
    }

    res.send(`
        <html>
            <head>
                <title>iPad WhatsApp</title>
                <meta http-equiv="refresh" content="2"> <!-- Sayfa her 2 saniyede bir yenilenir -->
            </head>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                <h1>WhatsApp Bağlantısı</h1>
                <p>Lütfen QR kodun yüklenmesini bekleyin ve telefonunuzla okutun.</p>
                <div style="margin-top: 30px; min-height: 350px;">
                    ${qrImgTag}
                </div>
                <p style="margin-top: 20px; font-size: 12px; color: gray;">Durum: ${connectionStatus} | Sayfa otomatik yenileniyor.</p>
            </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
    connectToWhatsApp();
});

async function connectToWhatsApp() {
    // ÖNEMLİ: Her başlatmada eski oturumu sil ki yeni QR gelsin
    const fs = require('fs');
    if (fs.existsSync('./auth_info_baileys')) {
        fs.rmSync('./auth_info_baileys', { recursive: true, force: true });
        console.log('Eski oturum silindi, yeni QR bekleniyor.');
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['iPad 2', 'Safari', '9.3.5'] // iPad 2 olarak tanıtıyoruz
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            connectionStatus = 'QR Kod Hazır, Taratın!';
            try {
                // QR verisini doğrudan görsel linkine çevir
                currentQR = await qrcode.toDataURL(qr, { width: 400, margin: 2 });
                console.log('QR kod başarıyla oluşturuldu.');
            } catch (err) {
                console.error('QR oluşturma hatası:', err);
                connectionStatus = 'QR Oluşturulamadı, Hata!';
            }
        } else if (connection === 'open') {
            connectionStatus = '✅ BAŞARIYLA BAĞLANDI!';
            currentQR = null; // Bağlanınca QR'ı kaldır
            console.log('WhatsApp bağlandı!');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'Bağlantı kapandı, yeniden başlatılıyor...';
            currentQR = null;
            console.log('Bağlantı kapandı. Yeniden deneniyor:', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp(); // Tekrar bağlanmayı dene
            }
        }
    });
}

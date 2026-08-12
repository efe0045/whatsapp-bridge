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
let isConnected = false;
let qrAttempts = 0;

// Eski oturumu temizle
const sessionPath = path.join(__dirname, 'auth_info_baileys');
if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
}

app.get('/', (req, res) => {
    if (isConnected) {
        // EĞER BAĞLANDIYSA: iPad'e özel çok basit bir sayfa göster.
        // Bu sayfa, WhatsApp'ın kendisi değil, sadece "Bağlandın" yazan bir HTML.
        // Artık bu aşamadan sonra iPad'den web.whatsapp.com'u açmayı deneme, çünkü açmıyor.
        // Bu yöntemle en azından cihazın kilitlenmesini önlüyoruz.
        res.send(`
            <html>
            <head>
                <title>iPad 2 WhatsApp Aktif</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background-color: #dcf8c6;">
                <h1 style="color: #075e54;">✅ BAŞARIYLA BAĞLANDI!</h1>
                <p>Sunucu şu an hesabınızı açık tutuyor.</p>
                <p style="color:gray; font-size:12px;">iPad 2 tarayıcısı WhatsApp Web'i tam desteklemediği için arayüz yüklenmeyebilir.</p>
                <br>
                <a href="http://google.com" style="padding: 10px 20px; background: #075e54; color: white; text-decoration: none; border-radius: 5px;">Çıkış Yap ve Yeniden Başlat</a>
            </body>
            </html>
        `);
        return;
    }

    // QR Kod Gösterimi
    let content = '';
    if (qrImage) {
        content = `
            <h1 style="color: #333; font-family: sans-serif;">iPad 2 Bağlantısı</h1>
            <p style="font-family: sans-serif;">QR Kod başarıyla oluşturuldu.</p>
            <img src="${qrImage}" alt="QR Code" style="max-width:300px; border: 5px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.2);">
            <p style="font-family: sans-serif; color:blue; margin-top:15px;"><b>Telefonunuzdan okutun...</b></p>
        `;
    } else {
        content = `
            <h1 style="color: blue; font-family: sans-serif;">${connectionStatus}</h1>
            <p style="font-family: sans-serif;">Sunucu hazırlanıyor, lütfen bekleyin...</p>
            ${qrAttempts > 5 ? '<p style="color:red; font-size:12px;">Bağlantı uzun sürdü. Sayfayı yenileyin.</p>' : ''}
        `;
    }

    res.send(`
        <html>
            <head>
                <title>iPad WhatsApp Kurulum</title>
                <meta http-equiv="refresh" content="3">
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
        browser: ['iPad 2', 'Safari', '9.3.5'], // iPad 2 imzası
        qrTimeout: 40000, // QR süresini uzat
        connectTimeoutMs: 60000,
        patchMessageBeforeSending: (msg) => { return msg; }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            if (!isConnected) {
                qrAttempts++;
                connectionStatus = 'QR Kod Hazır (' + qrAttempts + ')';
                try {
                    qrImage = await qrcode.toDataURL(qr, { width: 300 });
                } catch (err) { }
            }
        }

        if (connection === 'open') {
            isConnected = true;
            connectionStatus = '✅ BAŞARIYLA BAĞLANDI!';
            qrImage = null; 
            console.log('WhatsApp başarıyla bağlandı.');
        } else if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect && !isConnected) {
                connectionStatus = 'Bağlantı koptu, yeniden bağlanılıyor...';
                qrImage = null;
                connectToWhatsApp();
            } else if (!isConnected) {
                connectionStatus = 'Oturum kapandı. Render\'da Deploy edin.';
                qrImage = null;
                isConnected = false;
            }
        }
    });
}

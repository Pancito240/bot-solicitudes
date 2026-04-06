const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error('❌ ERROR: BOT_TOKEN no encontrado');
    process.exit(1);
}

// Archivo para almacenar solicitudes pendientes
const PENDING_FILE = '/tmp/solicitudes_pendientes.json';
let solicitudesPendientes = {};

// Cargar solicitudes guardadas
if (fs.existsSync(PENDING_FILE)) {
    try {
        const data = fs.readFileSync(PENDING_FILE, 'utf8');
        solicitudesPendientes = JSON.parse(data);
        console.log('📋 Solicitudes pendientes cargadas');
    } catch (e) {
        console.log('No se pudieron cargar solicitudes previas');
    }
}

function guardarSolicitudes() {
    try {
        fs.writeFileSync(PENDING_FILE, JSON.stringify(solicitudesPendientes, null, 2));
    } catch (e) {
        console.error('Error guardando solicitudes:', e);
    }
}

console.log('✅ Token encontrado');
console.log('🚀 Iniciando bot...');

const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.get('/health', (req, res) => res.send('OK'));

// Escuchar NUEVAS solicitudes (las guarda pero NO las acepta)
bot.on('chat_join_request', async (request) => {
    const chatId = request.chat.id;
    const userId = request.from.id;
    const userName = request.from.first_name;
    const userUsername = request.from.username || 'sin username';
    
    if (!solicitudesPendientes[chatId]) {
        solicitudesPendientes[chatId] = [];
    }
    
    const yaExiste = solicitudesPendientes[chatId].some(s => s.userId === userId);
    
    if (!yaExiste) {
        solicitudesPendientes[chatId].push({
            userId: userId,
            userName: userName,
            username: userUsername,
            fecha: new Date().toISOString()
        });
        
        guardarSolicitudes();
        console.log(`📝 Nueva solicitud guardada de: ${userName} en grupo ${chatId}`);
        console.log(`📊 Total pendientes: ${solicitudesPendientes[chatId].length}`);
    }
});

// Comando /aceptar - Acepta TODAS las solicitudes pendientes
bot.onText(/\/aceptar/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (msg.chat.type === 'private') {
        return bot.sendMessage(chatId, '❌ Este comando solo funciona en grupos.');
    }
    
    if (!solicitudesPendientes[chatId] || solicitudesPendientes[chatId].length === 0) {
        return bot.sendMessage(chatId, '✅ No hay solicitudes pendientes para aceptar.');
    }
    
    // Verificar que el bot sea administrador
    try {
        const botInfo = await bot.getMe();
        const admins = await bot.getChatAdministrators(chatId);
        const isAdmin = admins.some(admin => admin.user.id === botInfo.id);
        
        if (!isAdmin) {
            return bot.sendMessage(chatId, '❌ Necesito ser administrador del grupo para aceptar solicitudes.\n\nPor favor, hazme administrador con permiso de "Invitar usuarios".');
        }
    } catch (error) {
        return bot.sendMessage(chatId, '❌ Error verificando permisos. ¿Soy administrador del grupo?');
    }
    
    const cantidad = solicitudesPendientes[chatId].length;
    await bot.sendMessage(chatId, `🔄 Procesando ${cantidad} solicitud${cantidad !== 1 ? 'es' : ''} pendiente${cantidad !== 1 ? 's' : ''}...`);
    
    let aceptadas = 0;
    let errores = 0;
    
    for (const solicitud of solicitudesPendientes[chatId]) {
        try {
            await bot.approveChatJoinRequest(chatId, solicitud.userId);
            aceptadas++;
            console.log(`✅ Aceptada: ${solicitud.userName}`);
            await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
            errores++;
            console.error(`❌ Error aceptando a ${solicitud.userName}:`, error.message);
        }
    }
    
    // Limpiar solicitudes pendientes del grupo
    delete solicitudesPendientes[chatId];
    guardarSolicitudes();
    
    const resumen = `✅ **Todas las solicitudes han sido aceptadas**\n\n📊 **Resumen:**\n• Aceptadas: ${aceptadas}\n• Errores: ${errores}\n• Total procesadas: ${cantidad}`;
    
    await bot.sendMessage(chatId, resumen, { parse_mode: 'Markdown' });
});

// Comando /pendientes - Ver cuántas solicitudes hay pendientes
bot.onText(/\/pendientes/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (msg.chat.type === 'private') {
        return bot.sendMessage(chatId, '❌ Este comando solo funciona en grupos.');
    }
    
    const pendientes = solicitudesPendientes[chatId] || [];
    const cantidad = pendientes.length;
    
    if (cantidad === 0) {
        return bot.sendMessage(chatId, '📭 No hay solicitudes pendientes en este momento.');
    }
    
    let lista = `📋 **Solicitudes pendientes: ${cantidad}**\n\n`;
    const mostrar = pendientes.slice(0, 10);
    
    for (let i = 0; i < mostrar.length; i++) {
        const s = mostrar[i];
        lista += `${i + 1}. ${s.userName} ${s.username ? `(@${s.username})` : ''}\n`;
    }
    
    if (cantidad > 10) {
        lista += `\n*Y ${cantidad - 10} más...*`;
    }
    
    lista += `\n\n💡 Usa /aceptar para aceptar todas.`;
    await bot.sendMessage(chatId, lista, { parse_mode: 'Markdown' });
});

// Comando /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 
        `🤖 **Bot de Aceptación de Solicitudes**

**Comandos disponibles:**
• /aceptar - Acepta TODAS las solicitudes pendientes
• /pendientes - Muestra cuántas solicitudes están esperando

**¿Cómo funciona?**
1. El bot guarda cada solicitud que llega al grupo
2. Cuando ejecutas /aceptar, acepta TODAS las guardadas
3. Las solicitudes se aceptan SOLO cuando usas el comando

**Requisitos:**
• El bot debe ser administrador del grupo
• Permiso de "Invitar usuarios" activado
• El grupo debe tener "Requerir aprobación" activado

✅ Bot funcionando 24/7 en la nube.`,
        { parse_mode: 'Markdown' }
    );
});

app.listen(PORT, () => {
    console.log(`✅ Servidor en puerto ${PORT}`);
    console.log(`🤖 Bot listo para usar en Telegram`);
    console.log(`💡 Comandos: /aceptar, /pendientes`);
});

console.log('🎉 Inicialización completa');

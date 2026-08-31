require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const PREFIX = "!";

client.once('ready', () => { console.log(`🤖 Bot Tactique Wplace en ligne.`); });

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Protection officiers (Permission Gérer les messages)
    if (['grief', 'build', 'actu', 'done', 'fausse', 'danger'].includes(command)) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply("❌ Permission refusée à l'affichage de l'état-major.");
        }
    }

    // 🔨 COMMANDES DE CRÉATION DE ZONES (Exemple: !build [X] [Y] [Rayon] [Description])
    if (command === 'grief' || command === 'build' || command === 'actu') {
        const x = parseInt(args[0]);
        const y = parseInt(args[1]);
        let radius = 0;
        let descIndex = 2;

        // Si le 3ème argument est un nombre, on l'interprète comme un rayon de zone (ex: 50px de surveillance)
        if (!isNaN(parseInt(args[2]))) {
            radius = parseInt(args[2]);
            descIndex = 3;
        }

        const description = args.slice(descIndex).join(" ") || "Aucun rapport rédigé.";
        const authorName = message.author.username; // On enregistre qui a envoyé l'ordre !

        const { data, error } = await supabase
            .from('wplace_events')
            .insert([{ type: command, x, y, radius, description, author: authorName, status: 'actif' }])
            .select();

        if (error) return message.reply("⚠️ Erreur d'écriture BDD.");

        const embed = new EmbedBuilder()
            .setColor(command === 'grief' ? 0xFF0000 : 0x00A2FF)
            .setTitle(`📍 Zone Tactique Déployée (#${data[0].id})`)
            .setDescription(`**Auteur :** ${authorName}\n**Type :** ${command.toUpperCase()}\n**Rayon :** ${radius}px\n**Coordonnées :** X: ${x} | Y: ${y}\n**Note :** ${description}`);
        return message.reply({ embeds: [embed] });
    }

    // ✅ COMMANDE FIN DE CONSTRUCTION (Passe la zone en Vert "Done")
    if (command === 'done') {
        const id = parseInt(args[0]);
        await supabase.from('wplace_events').update({ type: 'done', status: 'termine' }).eq('id', id);
        return message.reply(`✅ Zone #${id} marquée comme **Terminée (Vert)**.`);
    }

    // ⚠️ COMMANDE VERIFICATION AMICALE (Passe la zone en Violet Clair "Fausse Alerte")
    if (command === 'fausse') {
        const id = parseInt(args[0]);
        await supabase.from('wplace_events').update({ status: 'fausse_alerte' }).eq('id', id);
        return message.reply(`⚠️ Zone #${id} vérifiée : Marquée comme **Fausse Alerte (Violet Clair)**.`);
    }

    // ☣️ COMMANDE DESIGNATION DANGER DE MASSE (Passe la zone en Violet Sombre "+2000px")
    if (command === 'danger') {
        const id = parseInt(args[0]);
        await supabase.from('wplace_events').update({ status: 'infiltration' }).eq('id', id);
        return message.reply(`☣️ ALERTE CRITIQUE sur la Zone #${id} : Attaque massive de +2000px détectée (Violet Foncé) !`);
    }
});

client.login(process.env.DISCORD_TOKEN);

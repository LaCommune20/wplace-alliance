require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// Connexion à Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuration du Bot Discord (lecture des messages et salons)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const PREFIX = "!";

client.once('ready', () => {
    console.log(`🤖 Bot Wplace connecté en tant que ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    // Ignore les bots et les messages sans le préfixe
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // COMMANDES COMPATIBLES : !grief, !build, !actu
    if (command === 'grief' || command === 'build' || command === 'actu') {
        const x = parseInt(args[0]);
        const y = parseInt(args[1]);

        if (isNaN(x) || isNaN(y)) {
            return message.reply("❌ Coordonnées invalides ! Syntaxe : `!grief [X] [Y] [Description]`");
        }

        let radius = 0;
        let descriptionIndex = 2;

        // Si c'est un build, on peut optionnellement spécifier un rayon en 3e argument
        if (command === 'build' && !isNaN(parseInt(args[2]))) {
            radius = parseInt(args[2]);
            descriptionIndex = 3;
        }

        const description = args.slice(descriptionIndex).join(" ") || "Aucune description fournie.";

        // Insertion dans Supabase
        const { data, error } = await supabase
            .from('wplace_events')
            .insert([{ type: command, x, y, radius, description }])
            .select();

        if (error) {
            console.error(error);
            return message.reply("⚠️ Erreur technique lors de l'enregistrement de l'événement.");
        }

        const event = data[0];
        const embed = new EmbedBuilder()
            .setColor(command === 'grief' ? 0xFF0000 : command === 'build' ? 0x00A2FF : 0x00FF00)
            .setTitle(`📍 Nouvel événement Wplace enregistré !`)
            .setDescription(`**Type :** ${command.toUpperCase()}\n**Coordonnées :** X: ${x} | Y: ${y}\n**Note :** ${description}`)
            .setFooter({ text: `Pour le supprimer, tapez : !done ${event.id}` });

        return message.reply({ embeds: [embed] });
    }

    // COMMANDE DE SUPPRESSION : !done [ID]
    if (command === 'done') {
        const id = parseInt(args[0]);
        if (isNaN(id)) return message.reply("❌ Syntaxe : `!done [ID_evenement]` (L'ID est écrit sur l'alerte du bot).");

        // On passe le statut en "termine" au lieu de supprimer pour garder un historique
        const { data, error } = await supabase
            .from('wplace_events')
            .update({ status: 'termine' })
            .eq('id', id)
            .select();

        if (error || data.length === 0) {
            return message.reply("⚠️ Événement introuvable ou déjà terminé.");
        }

        return message.reply(`✅ L'objectif #${id} a été validé ! Il disparaît de la carte.`);
    }
});

client.login(process.env.DISCORD_TOKEN);

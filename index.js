{\rtf1\ansi\ansicpg1252\cocoartf2580
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx566\tx1133\tx1700\tx2267\tx2834\tx3401\tx3968\tx4535\tx5102\tx5669\tx6236\tx6803\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import \{ Client, GatewayIntentBits, Events \} from 'discord.js';\
\
const client = new Client(\{\
  intents: [GatewayIntentBits.Guilds],\
\});\
\
client.once(Events.ClientReady, () => \{\
  console.log(`GG Sports is online as $\{client.user.tag\}`);\
\});\
\
client.on(Events.InteractionCreate, async (interaction) => \{\
  console.log(\
    'Interaction received:',\
    interaction.isChatInputCommand() ? interaction.commandName : 'not-chat-command'\
  );\
\
  if (!interaction.isChatInputCommand()) return;\
\
  try \{\
    if (interaction.commandName === 'testbotreply') \{\
      await interaction.reply('GG Sports test worked.');\
      console.log('Reply sent.');\
    \}\
  \} catch (error) \{\
    console.error('Reply failed:', error);\
  \}\
\});\
\
client.login(process.env.DISCORD_TOKEN);}
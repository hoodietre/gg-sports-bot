{\rtf1\ansi\ansicpg1252\cocoartf2580
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx566\tx1133\tx1700\tx2267\tx2834\tx3401\tx3968\tx4535\tx5102\tx5669\tx6236\tx6803\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import \{ REST, Routes, SlashCommandBuilder \} from 'discord.js';\
\
const CLIENT_ID = '1407760487151833200';\
const GUILD_ID = '1486545386649686068';\
\
const commands = [\
  new SlashCommandBuilder()\
    .setName('testbotreply')\
    .setDescription('Fresh test command')\
    .toJSON(),\
];\
\
const rest = new REST(\{ version: '10' \}).setToken(process.env.DISCORD_TOKEN);\
\
await rest.put(\
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),\
  \{ body: commands \}\
);\
\
console.log('Fresh guild command deployed.');}
// Voice membership can survive a gateway reconnect while in-memory queues cannot.
export async function sendVoiceLeave(guild) {
  if (!guild) return;
  await guild.shard.send({ op: 4, d: { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: false } });
}

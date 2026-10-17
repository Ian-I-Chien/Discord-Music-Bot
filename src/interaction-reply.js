// Complete deferred replies before deleting them so clients see a settled interaction.
export async function finishQuietReply(interaction) {
  await interaction.editReply({ content: '\u200b', allowedMentions: { parse: [] } });
  await interaction.deleteReply().catch(error => {
    console.warn('清除指令回覆失敗：', error.code ?? error.name, error.message);
  });
}
// Wait outside the guild command lock so /leave and other controls remain usable.
export function waitForPlayback(session, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      let error;
      if (session.closed) error = new Error('播放已取消。');
      else if (session.current && session.hasStarted) { cleanup(); resolve(); return; }
      else if (!session.loading && !session.current && !session.queue.length && !session.playlistImports?.size) error = new Error('無法開始播放，請稍後重試。');
      else if (Date.now() - started >= timeoutMs) error = new Error('等待播放逾時，請稍後查看播放面板。');
      if (error) { cleanup(); reject(error); }
    };
    const cleanup = () => { clearInterval(timer); session.player.off('stateChange', check); };
    const timer = setInterval(check, 100);
    session.player.on('stateChange', check);
    check();
  });
}


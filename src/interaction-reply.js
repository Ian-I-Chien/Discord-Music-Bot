// Complete deferred replies before deleting them so clients see a settled interaction.
export async function finishQuietReply(interaction) {
  await interaction.editReply({ content: '\u200b', allowedMentions: { parse: [] } });
  await interaction.deleteReply().catch(error => {
    console.warn('清除指令回覆失敗：', error.code ?? error.name, error.message);
  });
}

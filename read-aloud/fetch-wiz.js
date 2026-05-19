const fs = require('fs');

(async () => {
  const response = await fetch("https://translate.google.com", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await response.text();
  const scriptStart = html.indexOf("WIZ_global_data = {");
  if (scriptStart === -1) {
    console.log("Not found");
    return;
  }
  const scriptEnd = html.indexOf("</script>", scriptStart);
  const text = html.substring(scriptStart, scriptEnd);
  fs.writeFileSync('wiz_data.txt', text);
  console.log("Saved wiz_data.txt");
})();

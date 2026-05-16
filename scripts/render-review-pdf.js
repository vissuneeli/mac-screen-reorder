const { app, BrowserWindow } = require('electron');
const path = require('path');

async function main() {
  const htmlPath = path.join(__dirname, '..', 'docs', 'screen-recorder-review.html');
  const pdfPath = path.join(__dirname, '..', 'docs', 'screen-recorder-review.pdf');

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      sandbox: true,
    },
  });

  await win.loadFile(htmlPath);
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'Letter',
    margins: {
      marginType: 'custom',
      top: 0.5,
      bottom: 0.5,
      left: 0.5,
      right: 0.5,
    },
  });

  require('fs').writeFileSync(pdfPath, pdf);
  win.destroy();
  console.log(pdfPath);
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.quit();
    process.exitCode = 1;
  });

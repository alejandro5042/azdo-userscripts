// const path = require('path');
// const CWD = process.cwd();
// const PACKAGE = require(path.join(CWD, 'package.json'));

const fs = require('fs');

module.exports = async ({name, bundler}) => {
  if (name !== bundler.mainBundle.name) {
    return;
  }
  const metaJs = bundler.mainBundle.entryAsset.name.replace('.user.js', '.meta.js').replace(/[\\/]src[\\/]/i, '/src/meta/');
  if (fs.existsSync(metaJs)) {
    return {
      header: `${fs.readFileSync(metaJs, 'utf8')}\n\n// *** See GitHub repo for original source (URL above). The following source is built with Parcel. ***\n\n`,
      footer: ''
    }
  }
}

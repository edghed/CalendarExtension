const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CALENDAR_FILE = "src/Calendar.tsx";
const MANIFEST_FILE = "azure-devops-extension.json";
const CONFIG_FILE = "deploy.config.json";

function logStep(msg) {
  console.log(`\n🔹 ${msg}`);
}

function fail(msg) {
  console.error(` ${msg}`);
  process.exit(1);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fail(`Fichier de config manquant : ${CONFIG_FILE}`);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  const requiredFields = ["projectRoot", "publisher", "pat", "extensionId", "organization"];

  for (const field of requiredFields) {
    if (!config[field]) {
      fail(`Champ manquant dans la config : ${field}`);
    }
  }

  return config;
}

//  Lire et incrémenter la version
function incrementVersionInManifest(root) {
  const manifestPath = path.join(root, MANIFEST_FILE);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const versionParts = manifest.version.split(".").map(Number);
  if (versionParts.length !== 3 || versionParts.some(isNaN)) {
    fail(`Version invalide dans manifest : ${manifest.version}`);
  }

  const oldVersion = manifest.version;
  versionParts[2] += 1;
  const newVersion = versionParts.join(".");
  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log(` Version incrémentée : ${oldVersion} → ${newVersion}`);
  return newVersion;
}

//  Mettre à jour Calendar.tsx
function updateCalendarVersion(root, version) {
  const calendarPath = path.join(root, CALENDAR_FILE);
  if (!fs.existsSync(calendarPath)) fail(`Fichier introuvable : ${calendarPath}`);

  let content = fs.readFileSync(calendarPath, "utf8");
  content = content.replace(/const EXTENSION_VERSION = "[^"]+"/, `const EXTENSION_VERSION = "${version}"`);
  fs.writeFileSync(calendarPath, content, "utf8");

  console.log(` src/Calendar.tsx mis à jour à ${version}`);
}

function cleanOldVsix(root) {
  logStep("Nettoyage des anciens fichiers .vsix...");
  const files = fs.readdirSync(root);
  files.forEach(file => {
    if (file.endsWith(".vsix")) {
      fs.unlinkSync(path.join(root, file));
      console.log(` Supprimé : ${file}`);
    }
  });
}

function buildProject(root) {
  logStep("Compilation du projet...");
  execSync("npm run build:release", { cwd: root, stdio: "inherit" });
}

function createVsix(root, publisher, extensionId, version) {
  logStep("Création du fichier .vsix...");
  const outputName = `${publisher}.${extensionId}-${version}.vsix`;
  execSync(
    `tfx extension create --manifest-globs ${MANIFEST_FILE} --root "${root}" --output-path "${outputName}"`,
    { stdio: "inherit" }
  );

  const fullPath = path.join(root, outputName);
  if (!fs.existsSync(fullPath)) fail("Fichier .vsix non trouvé après génération");
  console.log(` VSIX généré : ${fullPath}`);
  return fullPath;
}

function publishVsix(vsixPath, publisher, token) {
  logStep("Publication de l'extension...");
  execSync(`tfx extension publish --vsix "${vsixPath}" --publisher "${publisher}" --auth-type pat --token "${token}"`, {
    stdio: "inherit"
  });
}

function shareExtension(publisher, extensionId, organization) {
  logStep("Partage de l'extension avec l'organisation...");
  execSync(`tfx extension share --publisher "${publisher}" --extension-id "${extensionId}" --share-with "${organization}"`, {
    stdio: "inherit"
  });
}

//  MAIN
(() => {
  try {
    const config = loadConfig();

    const newVersion = incrementVersionInManifest(config.projectRoot);
    updateCalendarVersion(config.projectRoot, newVersion);
    cleanOldVsix(config.projectRoot);
    buildProject(config.projectRoot);
    const vsixPath = createVsix(config.projectRoot, config.publisher, config.extensionId, newVersion);
    publishVsix(vsixPath, config.publisher, config.pat);
    shareExtension(config.publisher, config.extensionId, config.organization);

    console.log(`\n Déploiement terminé ! Version publiée : ${newVersion}`);
  } catch (err) {
    fail(err.message);
  }
})();

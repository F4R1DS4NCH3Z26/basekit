<?php
// Adjusts a fresh Symfony skeleton for basekit (used by `make new-app`, inside the composer:2 container).
//   setup.php composer <php-platform>   before installing: composer.json settings
//   setup.php config <.env.example>     after the recipes: Doctrine mapping/URL and missing variables
//   setup.php config-mongo <.env.example>   the same with Doctrine MongoDB ODM (MongoDB overlay) instead of the ORM
// It runs in the working copy of the new app (cwd) and never writes outside it, except .env.example.
declare(strict_types=1);

$mode = $argv[1] ?? '';

if ($mode === 'composer') {
    $platform = $argv[2] ?? '';
    if (preg_match('/^\d+\.\d+\.\d+$/', $platform) !== 1) {
        fwrite(STDERR, "setup.php: invalid PHP platform '$platform'\n");
        exit(2);
    }
    // Objects, not arrays: an empty JSON object (the skeleton's "require-dev": {}) decoded as an array is written
    // back as [], and Composer then rejects composer.json ("Array value found, but an object is required").
    $json = json_decode((string) file_get_contents('composer.json'), false, flags: JSON_THROW_ON_ERROR);
    $json->config ??= new stdClass();
    $json->config->platform ??= new stdClass();
    $json->config->platform->php = $platform;
    $json->extra ??= new stdClass();
    // Flex must not add its own compose files: the kit already has them.
    $json->extra->symfony ??= new stdClass();
    $json->extra->symfony->docker = false;
    // The environment comes from compose (env_file + overlays); there is no .env inside the image.
    $json->extra->runtime ??= new stdClass();
    $json->extra->runtime->disable_dotenv = true;
    file_put_contents('composer.json', json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    echo "  ~ composer.json: platform php $platform, runtime.disable_dotenv, symfony.docker=false\n";
    exit(0);
}

if ($mode !== 'config' && $mode !== 'config-mongo') {
    fwrite(STDERR, "Uso: setup.php composer <php-platform> | config <.env.example> | config-mongo <.env.example>\n");
    exit(2);
}

require getcwd() . '/vendor/autoload.php';

// The variables of the skeleton .env that the kit never copies (compose sets them, or the overlay brings its own).
$skip = ['APP_ENV', 'APP_DEBUG', 'APP_SECRET', 'DATABASE_URL'];

if ($mode === 'config-mongo') {
    // 1. Doctrine MongoDB ODM: documents live in src/Modules/*/Domain/Entity; the connection is MONGO_URL (the app
    //    user, authSource = DB_NAME) and the database DB_DATABASE, both injected by the MongoDB overlay. The file is
    //    written whole over the one of the bundle's recipe (MONGODB_URI, src/Document), which the kit does not use.
    $file = 'config/packages/doctrine_mongodb.yaml';
    file_put_contents($file, <<<'YAML'
        # Ajustado por basekit: Doctrine MongoDB ODM, documentos en src/Modules, MONGO_URL del overlay de infra-setup.
        # Los índices se declaran en los documentos (#[ODM\Index]) y los crea make migrate (doctrine:mongodb:schema:create --index).
        doctrine_mongodb:
            auto_generate_proxy_classes: true
            auto_generate_hydrator_classes: true
            connections:
                default:
                    server: '%env(MONGO_URL)%'
                    options: {}
            default_database: '%env(DB_DATABASE)%'
            document_managers:
                default:
                    auto_mapping: false
                    mappings:
                        Modules:
                            type: attribute
                            is_bundle: false
                            dir: '%kernel.project_dir%/src/Modules'
                            prefix: 'App\Modules'
                            alias: Modules

        when@prod:
            doctrine_mongodb:
                auto_generate_proxy_classes: false
                auto_generate_hydrator_classes: false

        YAML);
    echo "  ~ $file: mapping src/Modules, server %env(MONGO_URL)%\n";
    // The recipe registers the bundle; if it was skipped, register it here.
    $bundles = 'config/bundles.php';
    $code = (string) file_get_contents($bundles);
    if (!str_contains($code, 'DoctrineMongoDBBundle')) {
        $code = preg_replace('/\n\];\s*$/', "\n    Doctrine\\Bundle\\MongoDBBundle\\DoctrineMongoDBBundle::class => ['all' => true],\n];\n", $code, 1, $count);
        if ($count !== 1) {
            fwrite(STDERR, "setup.php: $bundles has no closing '];'; register DoctrineMongoDBBundle by hand\n");
            exit(1);
        }
        file_put_contents($bundles, $code);
        echo "  ~ $bundles: DoctrineMongoDBBundle\n";
    }
    $skip = [...$skip, 'MONGODB_URI', 'MONGODB_DB'];
} else {
    // 1. Doctrine: entities live in src/Modules/*/Domain/Entity, and DATABASE_URL may come as file:/app/data/app.db
    //    (SQLite overlay); the db_url processor (src/Core/Doctrine) turns it into a DBAL URL.
    $file = 'config/packages/doctrine.yaml';
    $doctrine = \Symfony\Component\Yaml\Yaml::parseFile($file);
    if (isset($doctrine['doctrine']['orm']['entity_managers'])) {
        fwrite(STDERR, "setup.php: $file uses several entity managers; adjust the mapping by hand\n");
        exit(1);
    }
    $doctrine['doctrine']['dbal']['url'] = '%env(db_url:resolve:DATABASE_URL)%';
    $doctrine['doctrine']['orm']['mappings'] = [
        'Modules' => [
            'type' => 'attribute',
            'is_bundle' => false,
            'dir' => '%kernel.project_dir%/src/Modules',
            'prefix' => 'App\\Modules',
            'alias' => 'Modules',
        ],
    ];
    file_put_contents($file, "# Ajustado por basekit: entidades en src/Modules, DATABASE_URL del overlay de infra-setup.\n"
        . \Symfony\Component\Yaml\Yaml::dump($doctrine, 8, 4));
    echo "  ~ $file: mapping src/Modules, url %env(db_url:resolve:DATABASE_URL)%\n";
}

// 2. Variables the recipes put in the skeleton .env: the ones missing from the kit .env.example are appended,
//    so `make env` creates them. Environment, debug, secret and database come from compose or are already there.
$target = $argv[2] ?? '';
if ($target === '' || !is_file($target) || is_link($target)) {
    echo "  = .env.example (no se actualizó: falta o es un enlace)\n";
    exit(0);
}
$parse = static function (string $path): array {
    $vars = [];
    foreach (is_file($path) ? file($path, FILE_IGNORE_NEW_LINES) : [] as $line) {
        if (preg_match('/^([A-Z][A-Z0-9_]*)=(.*)$/', $line, $m) === 1) {
            $vars[$m[1]] = $m[2];
        }
    }
    return $vars;
};
$have = $parse($target);
$add = [];
foreach ($parse('.env') as $key => $value) {
    if (!isset($have[$key]) && !in_array($key, $skip, true)) {
        $add[] = "$key=$value";
    }
}
if ($add === []) {
    echo "  = .env.example\n";
    exit(0);
}
$content = rtrim((string) file_get_contents($target), "\n") . "\n# Symfony (recipes)\n" . implode("\n", $add) . "\n";
$tmp = $target . '.tmp' . getmypid();
file_put_contents($tmp, $content);
rename($tmp, $target);
echo '  ~ .env.example: ' . implode(', ', array_map(static fn (string $l): string => strstr($l, '=', true), $add)) . "\n";

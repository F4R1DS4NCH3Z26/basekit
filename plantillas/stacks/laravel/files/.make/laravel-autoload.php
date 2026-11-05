<?php
// Agrega "App\Modules\" => "src/Modules/" al autoload PSR-4 de composer.json (lo usa `make new-app`).
declare(strict_types=1);
$file = $argv[1] ?? 'composer.json';
$json = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
$json['autoload']['psr-4']['App\\Modules\\'] = 'src/Modules/';
file_put_contents($file, json_encode($json, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
echo "  ~ composer.json: App\\Modules\\ => src/Modules/\n";

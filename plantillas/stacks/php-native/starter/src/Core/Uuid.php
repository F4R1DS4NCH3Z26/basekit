<?php

declare(strict_types=1);

namespace App\Core;

/** UUID v7 (time ordered, good as a primary key) without a library. Stored as CHAR(36). */
final class Uuid
{
    public static function v7(): string
    {
        $milliseconds = (int) floor(microtime(true) * 1000);
        $time = substr(pack('J', $milliseconds), 2, 6);
        $random = random_bytes(10);
        $random[0] = chr((ord($random[0]) & 0x0F) | 0x70);
        $random[2] = chr((ord($random[2]) & 0x3F) | 0x80);
        $hex = bin2hex($time . $random);

        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12),
        );
    }

    public static function isValid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $value) === 1;
    }
}

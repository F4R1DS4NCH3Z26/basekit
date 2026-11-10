<?php

declare(strict_types=1);

namespace App\Core\Database;

/**
 * Splits a migration file into statements on top-level `;`. It understands '...', "...", `...`
 * (doubled quotes as escapes), -- and /* *\/ comments and PostgreSQL $tag$ ... $tag$ bodies.
 * Comments are dropped. Backslash escapes inside strings are not supported: double the quote instead.
 */
final class SqlSplitter
{
    /** @return list<string> */
    public static function split(string $sql): array
    {
        $statements = [];
        $current = '';
        $length = strlen($sql);
        $i = 0;
        while ($i < $length) {
            $char = $sql[$i];
            $next = $sql[$i + 1] ?? '';
            if ($char === '-' && $next === '-') {
                $end = strpos($sql, "\n", $i);
                $i = $end === false ? $length : $end;
                continue;
            }
            if ($char === '/' && $next === '*') {
                $end = strpos($sql, '*/', $i + 2);
                if ($end === false) {
                    throw new \RuntimeException('Unterminated /* comment');
                }
                $current .= ' ';
                $i = $end + 2;
                continue;
            }
            if ($char === "'" || $char === '"' || $char === '`') {
                $end = self::closingQuote($sql, $char, $i + 1);
                $current .= substr($sql, $i, $end - $i + 1);
                $i = $end + 1;
                continue;
            }
            if ($char === '$' && preg_match('/\G\$([A-Za-z_][A-Za-z0-9_]*)?\$/', $sql, $m, 0, $i) === 1) {
                $tag = $m[0];
                $end = strpos($sql, $tag, $i + strlen($tag));
                if ($end === false) {
                    throw new \RuntimeException(sprintf('Unterminated %s quoted body', $tag));
                }
                $current .= substr($sql, $i, $end + strlen($tag) - $i);
                $i = $end + strlen($tag);
                continue;
            }
            if ($char === ';') {
                if (trim($current) !== '') {
                    $statements[] = trim($current);
                }
                $current = '';
                ++$i;
                continue;
            }
            $current .= $char;
            ++$i;
        }
        if (trim($current) !== '') {
            $statements[] = trim($current);
        }

        return $statements;
    }

    private static function closingQuote(string $sql, string $quote, int $from): int
    {
        while (true) {
            $end = strpos($sql, $quote, $from);
            if ($end === false) {
                throw new \RuntimeException(sprintf('Unterminated %s quote', $quote));
            }
            if (($sql[$end + 1] ?? '') !== $quote) {
                return $end;
            }
            $from = $end + 2;
        }
    }
}

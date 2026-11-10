<?php

declare(strict_types=1);

namespace App\Tests\Core;

use App\Core\Uuid;
use PHPUnit\Framework\TestCase;

final class UuidTest extends TestCase
{
    public function testV7IsValidVersion7AndTimeOrdered(): void
    {
        $first = Uuid::v7();
        usleep(2000);
        $second = Uuid::v7();

        self::assertTrue(Uuid::isValid($first));
        self::assertSame('7', $first[14]);
        self::assertContains($first[19], ['8', '9', 'a', 'b']);
        self::assertLessThan(0, strcmp($first, $second));
        self::assertFalse(Uuid::isValid('not-a-uuid'));
    }
}

<?php
declare(strict_types=1);

namespace App\Inventory;

use App\Support\Money;

/** Items know how to price themselves. */
class Item {
    private int $stock = 0;

    public function restock(int $n): void {
        // Guard against nonsense quantities.
        if ($n < 0) {
            return;
        }
        $this->stock += $n;
    }
}

function total(array $items): int {
    return count($items) * 10;
}

$pricer = fn(array $xs): int => count($xs);
$maker = function () { return 1; };

const TAX_RATE = 21;

interface Named {
    public function name(): string;
}

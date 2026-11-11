<?php

namespace tests\unit\Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Utils\Metadata;
use Espo\Modules\CalendarPlus\Tools\Calendar\TooltipLayout;
use Espo\Tools\Layout\LayoutProvider;
use PHPUnit\Framework\TestCase;

class TooltipLayoutTest extends TestCase
{
  private function service(?string $json): TooltipLayout
  {
    $provider = $this->createMock(LayoutProvider::class);
    $provider->method('get')->willReturn($json);
    $metadata = $this->createMock(Metadata::class);
    $metadata->method('get')->willReturnCallback(function ($path) {
      if ($path[0] === 'clientDefs') {
        return ['dateStart', 'dateEnd', 'assignedUser', ':attendees', 'status'];
      }

      return [
        'dateStart' => ['type' => 'datetime'],
        'dateEnd' => ['type' => 'datetime'],
        'assignedUser' => ['type' => 'link'],
        'users' => ['type' => 'linkMultiple'],
        'status' => ['type' => 'enum'],
      ];
    });

    return new TooltipLayout($metadata, $provider);
  }

  public function testExplicitEmptyLayoutDoesNotUseDefaults(): void
  {
    self::assertSame([], $this->service('[]')->fields('Meeting'));
  }

  public function testMissingLayoutUsesSupportedDefaults(): void
  {
    self::assertSame(
      ['dateStart', 'dateEnd', 'assignedUser', ':attendees', 'status'],
      $this->service(null)->fields('Meeting'),
    );
  }

  public function testSavedFieldsPreserveOrderAndIgnoreUnknownFields(): void
  {
    self::assertSame(
      ['status', ':attendees'],
      $this->service('[{"name":"status"},{"name":":attendees"},{"name":"unknown"},{"name":"status"}]')->fields('Meeting'),
    );
  }

  public function testLoaderOnlyFieldsAreExcludedFromTheEditor(): void
  {
    self::assertFalse(TooltipLayout::supportsField((object) ['type' => 'varchar', 'notStorable' => true]));
    self::assertFalse(TooltipLayout::supportsField((object) ['type' => 'file']));
    self::assertTrue(TooltipLayout::supportsField((object) ['type' => 'datetime']));
  }
}

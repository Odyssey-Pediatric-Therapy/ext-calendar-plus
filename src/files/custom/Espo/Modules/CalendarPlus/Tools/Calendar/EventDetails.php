<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Acl;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Record\ServiceContainer;
use Espo\Core\Select\SelectBuilderFactory;
use Espo\Core\Utils\Metadata;
use Espo\ORM\EntityManager;
use Espo\ORM\Query\Part\Selection as Column;
use stdClass;

/** Loads calendar detail projections with set queries, never record-by-record loaders. */
class EventDetails
{
  // Keep dates from Espo's calendar result. A custom calendar query can map
  // different record fields to dateStart/dateEnd, so raw dates must not override it.
  private const ATTRIBUTES = ['name', 'status', 'assignedUserName', 'location'];
  private const LINKS = ['assignedUsers', 'collaborators', 'users', 'contacts', 'leads'];
  public const MAX_RECORDS = 500;

  public function __construct(
    private EntityManager $entityManager,
    private SelectBuilderFactory $selectBuilderFactory,
    private Acl $acl,
    private Metadata $metadata,
    private ServiceContainer $services,
  ) {}

  /** @return array<string, stdClass> */

  public function fetch(mixed $groups): array {
    if (!$this->acl->check('Calendar')) {
      throw new Forbidden();
    }

    if (!$groups instanceof stdClass || count(get_object_vars($groups)) > 50) {
      throw new BadRequest('Invalid calendar detail selection.');
    }

    $selection = [];
    $count = 0;

    foreach (get_object_vars($groups) as $scope => $ids) {
      if (!$this->metadata->get(['scopes', $scope, 'calendar'])) {
        throw new BadRequest('Invalid calendar entity type.');
      }
      $selection[$scope] = Selection::ids($ids, self::MAX_RECORDS);
      $count += count($selection[$scope]);
    }

    if ($count > self::MAX_RECORDS) {
      throw new BadRequest('Too many calendar records.');
    }

    $result = [];

    foreach ($selection as $scope => $ids) {
      if (!$ids || !$this->acl->checkScope($scope, 'read')) {
        continue;
      }
      try {
        $result += $this->fetchScope($scope, $ids);
      } catch (Forbidden) {
        // Calendar visibility does not necessarily permit reading record details.
      }
    }

    return $result;
  }

  /** @param list<string> $ids
   * @return array<string, stdClass>
   */

  private function fetchScope(string $scope, array $ids): array {
    $seed = $this->entityManager->getNewEntity($scope);
    $forbidden = $this->acl->getScopeForbiddenAttributeList($scope);
    $attributes = array_values(array_filter(
      self::ATTRIBUTES,
      fn ($attribute) => $seed->hasAttribute($attribute) && !in_array($attribute, $forbidden, true),
    ));
    $query = $this->selectBuilderFactory
      ->create()
      ->from($scope)
      ->withStrictAccessControl()
      ->buildQueryBuilder()
      ->select(['id', ...$attributes])
      ->where(['id' => $ids])
      ->build();
    $entities = [];

    foreach ($this->entityManager->getRDBRepository($scope)->clone($query)->find() as $entity) {
      $entities[$entity->getId()] = $entity;
    }

    if (!$entities) {
      return [];
    }

    $defs = $this->entityManager->getDefs()->getEntity($scope);

    foreach (self::LINKS as $link) {
      if (
        !$defs->hasRelation($link) ||
        !$seed->hasAttribute($link . 'Names') ||
        !$this->acl->checkField($scope, $link) ||
        in_array($link . 'Names', $forbidden, true)
      ) {
        continue;
      }
      // Each relation gets one query for all readable records. Separate queries avoid
      // multiplying attendee rows by contacts, leads, and collaborators in a cross product.
      $relation = $defs->getRelation($link);
      $hasStatus = $relation->isManyToMany() &&
        isset(($relation->getParam('additionalColumns') ?? [])['status']) &&
        !in_array($link . 'Columns', $forbidden, true);
      $select = [
        'id',
        Column::fromString($link . '.id')->withAlias('personId'),
        Column::fromString($link . '.name')->withAlias('personName'),
      ];
      if ($hasStatus) {
        $select[] = Column::fromString($link . 'Middle.status')->withAlias('attendanceStatus');
      }
      $relationQuery = $this->entityManager
        ->getQueryBuilder()
        ->select($select)
        ->from($scope)
        ->join($link)
        ->where(['id' => array_keys($entities)])
        ->build();
      $names = $columns = [];
      $rows = $this->entityManager->getQueryExecutor()->execute($relationQuery);
      while ($row = $rows->fetch(\PDO::FETCH_ASSOC)) {
        $names[$row['id']][$row['personId']] = $row['personName'];
        if ($hasStatus) {
          $columns[$row['id']][$row['personId']] = (object) ['status' => $row['attendanceStatus']];
        }
      }
      foreach ($entities as $id => $entity) {
        $entity->set($link . 'Names', (object) ($names[$id] ?? []));
        if ($hasStatus) {
          $entity->set($link . 'Columns', (object) ($columns[$id] ?? []));
        }
      }
    }

    $result = [];
    $service = $this->services->get($scope);

    foreach ($entities as $id => $entity) {
      // Preserve Espo's field restrictions and custom output filters without invoking
      // read/list field loaders, which perform individual relation queries.
      $service->prepareEntityForOutput($entity);
      $data = new stdClass();
      $outputAttributes = [
        ...$attributes,
        ...array_map(fn ($link) => $link . 'Names', self::LINKS),
        'usersColumns',
        'contactsColumns',
        'leadsColumns',
      ];

      foreach ($outputAttributes as $attribute) {
        if ($entity->has($attribute)) {
          $data->{$attribute} = $entity->get($attribute);
        }
      }
      $result[$scope . ':' . $id] = $data;
    }

    return $result;
  }
}

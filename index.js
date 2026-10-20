import { Command, Option, Argument, InvalidArgumentError, CommanderError } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Допоміжні типи й константи
// ---------------------------------------------------------------------------

// Власний клас помилки: повідомлення з нього показуємо користувачеві як є.
class CliError extends Error {}

// Файл за замовчуванням лежить поруч з index.js, тому програму
// можна запускати з будь-якої теки.
const DEFAULT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'data.json');

// Допустимі призначення предметів (значення поля type зі структури з ЛР1).
const ITEM_TYPES = ['weapon', 'armor', 'consumable', 'quest'];

const STAT_LABELS = {
  strength: 'Сила',
  agility: 'Спритність',
  intellect: 'Інтелект',
  health: "Здоров'я",
  mana: 'Мана',
};

// ---------------------------------------------------------------------------
// Читання даних
// ---------------------------------------------------------------------------

function loadData(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new CliError(`Файл "${file}" не знайдено.`);
    if (err.code === 'EISDIR') throw new CliError(`"${file}" є текою, а не файлом.`);
    if (err.code === 'EACCES') throw new CliError(`Немає доступу до файлу "${file}".`);
    throw new CliError(`Не вдалося прочитати файл "${file}": ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new CliError(`Файл "${file}" містить некоректний JSON (${err.message}).`);
  }

  const ok =
    data !== null &&
    typeof data === 'object' &&
    Array.isArray(data.characters) &&
    data.characters.every((c) => c !== null && typeof c === 'object');
  if (!ok) {
    throw new CliError(
      `Файл "${file}" має неочікувану структуру: у корені потрібне поле characters (масив об'єктів).`,
    );
  }
  return data;
}

// Шлях береться з глобальної опції --file (її значення читаємо з головної програми).
function getData() {
  return loadData(program.opts().file);
}

// ---------------------------------------------------------------------------
// Перевірка значень аргументів
// ---------------------------------------------------------------------------

function parsePositiveInt(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError('Очікується додатне ціле число.');
  }
  return Number(value);
}

function parseItemType(value) {
  if (!ITEM_TYPES.includes(value)) {
    throw new InvalidArgumentError(`Допустимі значення: ${ITEM_TYPES.join(', ')}.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Допоміжні функції пошуку й виводу
// ---------------------------------------------------------------------------

function findCharacter(data, id) {
  const character = data.characters.find((c) => c.id === id);
  if (!character) {
    const ids = data.characters.map((c) => c.id).join(', ');
    throw new CliError(`Персонажа з id "${id}" не знайдено. Наявні id: ${ids}.`);
  }
  return character;
}

// Рух по шляху виду "inventory.0.name". Розрізняємо відсутнє поле (помилка)
// і поле зі значенням null (це коректне значення, наприклад guild або durability).
function resolvePath(root, path) {
  let current = root;
  const walked = [];
  for (const key of path.split('.')) {
    if (key === '') throw new CliError(`Шлях "${path}" містить порожню частину.`);
    walked.push(key);
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(key) || Number(key) >= current.length) {
        throw new CliError(`Поле "${walked.join('.')}" не знайдено: індекс "${key}" поза межами масиву.`);
      }
      current = current[Number(key)];
    } else if (current !== null && typeof current === 'object') {
      if (!Object.hasOwn(current, key)) {
        throw new CliError(`Поле "${walked.join('.')}" відсутнє в елементі.`);
      }
      current = current[key];
    } else {
      throw new CliError(
        `Поле "${walked.slice(0, -1).join('.')}" не є об'єктом чи масивом, тому "${key}" в ньому шукати не можна.`,
      );
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Опис програми
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('rpg')
  .description('Перегляд даних RPG-персонажів з JSON-файлу: характеристики, інвентар і навички.')
  .version('1.0.0', '-V, --version', 'Показати версію програми')
  .helpOption('-h, --help', 'Показати довідку')
  .helpCommand('help [command]', 'Показати довідку по команді')
  // Помилки commander не друкуємо самі: перехоплюємо їх і виводимо українською.
  .exitOverride()
  .configureOutput({ outputError: () => {} })
  .addOption(
    new Option('-f, --file <path>', 'Шлях до JSON-файлу з даними').default(
      DEFAULT_FILE,
      'data.json поруч з index.js',
    ),
  );

// --- Загальні можливості ----------------------------------------------------

program
  .command('list')
  .description('Показати стислий список персонажів')
  .option('-l, --limit <n>', 'Максимальна кількість персонажів у списку', parsePositiveInt)
  .action((options) => {
    const characters = getData().characters;
    const shown = options.limit ? characters.slice(0, options.limit) : characters;
    for (const c of shown) {
      console.log(`${c.id}  ${c.name} — ${c.class}, рівень ${c.level}`);
    }
    console.log(`Показано ${shown.length} з ${characters.length}.`);
  });

program
  .command('show')
  .description('Показати одного персонажа цілком')
  .argument('<id>', 'Ідентифікатор персонажа, напр. char-1001')
  .action((id) => {
    console.log(JSON.stringify(findCharacter(getData(), id), null, 2));
  });

program
  .command('get')
  .description('Показати значення окремого (зокрема вкладеного) поля персонажа')
  .argument('<id>', 'Ідентифікатор персонажа, напр. char-1001')
  .argument('<path>', 'Шлях до поля через крапку, напр. stats.mana або inventory.0.name')
  .action((id, path) => {
    const character = findCharacter(getData(), id);
    const value = resolvePath(character, path);
    if (value === null) {
      console.log('null (поле існує, але його значення порожнє)');
    } else if (typeof value === 'object') {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(value);
    }
  });

// --- Можливості варіанта 8: RPG-персонаж ------------------------------------

program
  .command('stats')
  .description('Показати рівень і характеристики персонажа')
  .argument('<id>', 'Ідентифікатор персонажа, напр. char-1001')
  .action((id) => {
    const c = findCharacter(getData(), id);
    console.log(`Персонаж: ${c.name} (${c.class})`);
    console.log(`Рівень: ${c.level}`);
    console.log(`Досвід: ${c.experience}`);
    console.log(`Стан: ${c.isAlive ? 'живий' : 'загинув'}`);
    // guild може бути null — персонаж просто не в гільдії.
    console.log(`Гільдія: ${c.guild === null ? 'не перебуває в гільдії' : c.guild}`);
    console.log('Характеристики:');
    for (const [stat, value] of Object.entries(c.stats)) {
      console.log(`  ${STAT_LABELS[stat] ?? stat}: ${value}`);
    }
  });

program
  .command('inventory')
  .description('Показати інвентар персонажа з відбором за призначенням та екіпіруванням')
  .argument('<id>', 'Ідентифікатор персонажа, напр. char-1001')
  .addOption(
    new Option('-t, --type <type>', `Лише предмети з таким призначенням (${ITEM_TYPES.join(', ')})`).argParser(
      parseItemType,
    ),
  )
  .option('-e, --equipped', 'Лише екіпіровані предмети')
  .action((id, options) => {
    const c = findCharacter(getData(), id);

    // Умови поєднуються через "і".
    const result = c.inventory.filter(
      (item) =>
        (!options.type || item.type === options.type) && (!options.equipped || item.equipped === true),
    );

    if (result.length === 0) {
      console.log('Предметів за вказаними умовами не знайдено.');
      return;
    }
    for (const item of result) {
      const parts = [`${item.type}`, `кількість: ${item.quantity}`, `вага: ${item.weight}`];
      // damage і armor присутні лише для зброї та броні — ключ може бути відсутній.
      if (Object.hasOwn(item, 'damage')) parts.push(`шкода: ${item.damage}`);
      if (Object.hasOwn(item, 'armor')) parts.push(`броня: ${item.armor}`);
      // durability: відсутній ключ, null і число — три різні випадки.
      if (!Object.hasOwn(item, 'durability')) parts.push('міцність: немає даних');
      else if (item.durability === null) parts.push('міцність: не зношується');
      else parts.push(`міцність: ${item.durability}%`);
      console.log(`${item.itemId}  ${item.name} — ${parts.join(', ')}${item.equipped ? ' [екіпіровано]' : ''}`);
    }
  });

program
  .command('skill')
  .description('Показати відомості про обрану навичку персонажа')
  .argument('<id>', 'Ідентифікатор персонажа, напр. char-1001')
  // Variadic-аргумент дозволяє писати назву з пробілами без лапок.
  .argument('<skill...>', 'Код або назва навички (регістр не важливий)')
  .action((id, skillParts) => {
    const c = findCharacter(getData(), id);
    const query = skillParts.join(' ').trim().toLowerCase();
    const skill = c.skills.find((s) => s.code.toLowerCase() === query || s.name.toLowerCase() === query);

    if (!skill) {
      const names = c.skills.map((s) => `${s.code} (${s.name})`).join(', ');
      throw new CliError(
        `У персонажа ${c.name} немає навички "${skillParts.join(' ')}". Наявні навички: ${names || 'немає'}.`,
      );
    }

    console.log(`Навичка: ${skill.name}`);
    console.log(`Код: ${skill.code}`);
    console.log(`Ранг: ${skill.rank}`);
    console.log(`Вартість мани: ${skill.manaCost}`);
    const enough = c.stats.mana >= skill.manaCost;
    console.log(
      `Мана персонажа: ${c.stats.mana} — ${enough ? 'вистачає' : 'не вистачає'} для застосування`,
    );
  });

// ---------------------------------------------------------------------------
// Запуск і обробка помилок
// ---------------------------------------------------------------------------

// Переклад службових повідомлень commander (вони англійською) українською.
function translateCommanderError(err) {
  const quoted = err.message.match(/'([^']+)'/)?.[1];
  switch (err.code) {
    case 'commander.missingArgument':
      return `Не вказано обов'язковий аргумент "${quoted}".`;
    case 'commander.optionMissingArgument':
      return `Для опції "${quoted}" не вказано значення.`;
    case 'commander.unknownOption':
      return `Невідома опція "${quoted}".`;
    case 'commander.unknownCommand':
      return `Невідома команда "${quoted}".`;
    case 'commander.excessArguments':
      return 'Забагато аргументів для цієї команди.';
    case 'commander.invalidArgument': {
      // Наприклад: "error: command-argument value 'x' is invalid for argument 'id'. Очікується..."
      // або "error: option '-l, --limit <n>' argument 'x' is invalid. Очікується..."
      const arg = err.message.match(/value '(.*?)' is invalid for argument '(.*?)'\. ?(.*)/s);
      if (arg) return `Некоректне значення "${arg[1]}" для аргументу "${arg[2]}". ${arg[3]}`;
      const opt = err.message.match(/option '(.*?)' argument '(.*?)' is invalid\. ?(.*)/s);
      if (opt) return `Некоректне значення "${opt[2]}" для опції "${opt[1]}". ${opt[3]}`;
      return err.message.replace(/^error: /, '');
    }
    default:
      return err.message.replace(/^error: /, '');
  }
}

const SILENT_CODES = ['commander.helpDisplayed', 'commander.help', 'commander.version'];

try {
  program.parse();
} catch (err) {
  if (err instanceof CommanderError) {
    // Довідка й версія вже виведені commander; просто завершуємо з його кодом.
    if (SILENT_CODES.includes(err.code)) process.exit(err.exitCode);
    console.error(`Помилка: ${translateCommanderError(err)}`);
    console.error('Довідка: node index.js --help');
    process.exit(1);
  }
  if (err instanceof CliError) {
    console.error(`Помилка: ${err.message}`);
    process.exit(1);
  }
  console.error(`Непередбачена помилка: ${err.message}`);
  process.exit(2);
}

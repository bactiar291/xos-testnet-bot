import { ethers } from "ethers";
import 'dotenv/config';
import { readFileSync } from 'fs';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

const abi = JSON.parse(readFileSync('./abi.json'));

const CONFIG = {
  RPC_URL: process.env.RPC_URL,
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  WXOS_CA: "0x0AAB67cf6F2e99847b9A95DeC950B250D648c1BB"
};

async function fetchBalances(wallet) {
  const spinner = ora(chalk.yellow('Memuat balance...')).start();
  try {
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    const xosBalance = await provider.getBalance(wallet.address);
    const wxosContract = new ethers.Contract(
      CONFIG.WXOS_CA,
      abi.WXOS_UNWRAP,
      provider
    );
    const wxosBalance = await wxosContract.balanceOf(wallet.address);
    spinner.succeed();
    return {
      xos: parseFloat(ethers.formatEther(xosBalance)).toFixed(8),
      wxos: parseFloat(ethers.formatEther(wxosBalance)).toFixed(8)
    };
  } catch (error) {
    spinner.fail(chalk.red('Gagal memuat balance'));
    throw error;
  }
}

async function mainMenu(balances) {
  console.clear();
  console.log(chalk.blue.bold('\n🔄 XOS Wrap/Unwrap Interface') + chalk.blue.bold(' author anam'));
  console.log(chalk.gray('----------------------------------'));
  console.log(chalk.green(`💰 XOS Balance: ${balances.xos}`));
  console.log(chalk.green(`💎 WXOS Balance: ${balances.wxos}`));
  console.log(chalk.gray('----------------------------------'));

  const { action } = await inquirer.prompt({
    type: 'list',
    name: 'action',
    message: 'Pilih aksi:',
    choices: [
      { name: '1. Wrap XOS ke WXOS', value: 'wrap' },
      { name: '2. Unwrap WXOS ke XOS', value: 'unwrap' },
      { name: '3. Keluar', value: 'exit' }
    ]
  });

  return action;
}

async function getExecutionMode() {
  const { mode } = await inquirer.prompt({
    type: 'list',
    name: 'mode',
    message: 'Pilih mode eksekusi:',
    choices: [
      { name: '1. Eksekusi sekali', value: 'single' },
      { name: '2. Eksekusi berulang', value: 'loop' }
    ]
  });

  let loopCount = 1;
  if (mode === 'loop') {
    const { count } = await inquirer.prompt({
      type: 'number',
      name: 'count',
      message: 'Masukkan jumlah eksekusi:',
      validate: input => input > 0 || 'Harap masukkan angka lebih dari 0'
    });
    loopCount = count;
  }

  return loopCount;
}

async function processTransaction(action, amount, wallet, loopInfo = {}) {
  const spinner = ora({
    text: chalk.yellow(`Memproses transaksi ${loopInfo.current}/${loopInfo.total}...`),
    color: 'yellow'
  }).start();

  try {
    const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    const contract = new ethers.Contract(
      CONFIG.WXOS_CA,
      action === 'wrap' ? abi.WXOS_WRAP : abi.WXOS_UNWRAP,
      wallet
    );

    const gasParams = {
      maxPriorityFeePerGas: ethers.parseUnits("10.5", "gwei"),
      maxFeePerGas: ethers.parseUnits("94.5", "gwei")
    };

    const amountWei = ethers.parseEther(amount.toString());
    let tx;

    spinner.text = chalk.yellow(`Mengestimasi gas (${loopInfo.current}/${loopInfo.total})...`);

    if (action === 'wrap') {
      const gasEstimate = await contract.deposit.estimateGas({
        value: amountWei,
        ...gasParams
      });

      spinner.text = chalk.yellow(`Melakukan wrapping (${loopInfo.current}/${loopInfo.total})...`);
      tx = await contract.deposit({
        value: amountWei,
        ...gasParams,
        gasLimit: gasEstimate * 12n / 10n
      });
    } else {
      const gasEstimate = await contract.withdraw.estimateGas(amountWei, gasParams);

      spinner.text = chalk.yellow(`Melakukan unwrapping (${loopInfo.current}/${loopInfo.total})...`);
      tx = await contract.withdraw(amountWei, {
        ...gasParams,
        gasLimit: gasEstimate * 12n / 10n
      });
    }

    spinner.succeed(chalk.green.bold(`Transaksi ${loopInfo.current}/${loopInfo.total} berhasil!`));
    return tx;
  } catch (error) {
    spinner.fail(chalk.red.bold(`Transaksi ${loopInfo.current}/${loopInfo.total} gagal!`));
    throw error;
  }
}

async function main() {
  if (!CONFIG.RPC_URL || !CONFIG.PRIVATE_KEY) {
    console.log(chalk.red.bold('ERROR:') + ' Pastikan RPC_URL dan PRIVATE_KEY sudah diisi di .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);

  while (true) {
    let balances = await fetchBalances(wallet);
    const action = await mainMenu(balances);

    if (action === 'exit') {
      console.log(chalk.yellow('\n👋 Sampai jumpa!'));
      break;
    }

    const maxAmount = action === 'wrap' ? balances.xos : balances.wxos;
    const { amount } = await inquirer.prompt({
      type: 'input',
      name: 'amount',
      message: `Masukkan jumlah ${action === 'wrap' ? 'XOS' : 'WXOS'} (maks ${maxAmount}):`,
      validate: input => {
        const valid = !isNaN(input) && parseFloat(input) > 0 && parseFloat(input) <= parseFloat(maxAmount);
        return valid || `Jumlah tidak valid! Maksimal ${maxAmount}`;
      }
    });

    const loopCount = await getExecutionMode();

    console.log(chalk.gray('\n----------------------------------'));
    console.log(chalk.blue.bold(`\n⚠️ Aksi: ${action === 'wrap' ? 'Wrapping' : 'Unwrapping'} ${amount} ${action === 'wrap' ? 'XOS' : 'WXOS'}`));
    console.log(chalk.blue(`🔄 Mode: ${loopCount === 1 ? 'Single' : 'Loop'} (${loopCount}x)`));

    const { confirm } = await inquirer.prompt({
      type: 'confirm',
      name: 'confirm',
      message: 'Konfirmasi transaksi?',
      default: true
    });

    if (!confirm) {
      console.log(chalk.yellow('\n🚫 Transaksi dibatalkan'));
      continue;
    }

    let successCount = 0;
    for (let i = 1; i <= loopCount; i++) {
      try {
        const tx = await processTransaction(action, amount, wallet, {
          current: i,
          total: loopCount
        });

        const confirmSpinner = ora({
          text: chalk.yellow(`Menunggu konfirmasi (${i}/${loopCount})...`),
          color: 'yellow'
        }).start();

        const receipt = await tx.wait(3);
        confirmSpinner.succeed(chalk.green(`Terkonfirmasi di block ${receipt.blockNumber}`));

        successCount++;
        balances = await fetchBalances(wallet);

        console.log(chalk.gray('----------------------------------'));
        console.log(chalk.green(`✅ Transaksi ${i}/${loopCount} berhasil!`));
        console.log(chalk.blue(`⛽ Gas Used: ${receipt.gasUsed.toString()}`));
        console.log(chalk.blue(`💰 XOS Balance: ${balances.xos}`));
        console.log(chalk.blue(`💎 WXOS Balance: ${balances.wxos}`));
        console.log(chalk.blue(`🕒 Waktu: ${new Date().toLocaleTimeString()}\n`));
      } catch (error) {
        console.log(chalk.red(`❌ Error: ${error.shortMessage || error.message}`));
        const { continueLoop } = await inquirer.prompt({
          type: 'confirm',
          name: 'continueLoop',
          message: 'Lanjutkan ke transaksi berikutnya?',
          default: true
        });
        if (!continueLoop) break;
      }
    }

    console.log(chalk.green.bold(`\n📊 Total berhasil: ${successCount}/${loopCount}`));

    const { restart } = await inquirer.prompt({
      type: 'confirm',
      name: 'restart',
      message: 'Lakukan transaksi lain?',
      default: true
    });

    if (!restart) {
      console.log(chalk.yellow('\n👋 Sampai jumpa!'));
      break;
    }
  }
}

main().catch(console.error);

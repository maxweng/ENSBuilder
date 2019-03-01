const ethers = require('ethers');

const defaultDeployOptions = {
  gasLimit: 4000000,
  gasPrice: 9000000000
};

const deployContract = async (wallet, contractJSON, args = [], overrideOptions = {}) => {
  const {provider} = wallet;
  const bytecode = `0x${contractJSON.bytecode}`;
  const abi = contractJSON.interface;
  const deployTransaction = {
    ...defaultDeployOptions,
    ...overrideOptions,
    ...new ethers.ContractFactory(abi, bytecode).getDeployTransaction(...args)
  };
  const tx = await wallet.sendTransaction(deployTransaction);
  await tx.wait()
  const receipt = await provider.getTransactionReceipt(tx.hash);
  // console.log({receipt})
  return new ethers.Contract(receipt.contractAddress, abi, wallet);
};

module.exports = {deployContract};

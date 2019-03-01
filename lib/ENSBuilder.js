const {utils} = require('ethers');
const {deployContract} = require('./utils');
const ENSRegistry = require('../abi/ENSRegistry');
const PublicResolver = require('../abi/PublicResolver');
const FIFSRegistrar = require('../abi/FIFSRegistrar');
const ReverseRegistrar = require('../abi/ReverseRegistrar');

const overrideOptions = {gasLimit: 4000000, gasPrice:1000000000};

const safeExecute = async (callback) => {

  try {
    const tx = await callback()
    console.log({tx})
    await tx.wait()
  } catch (err) {
    console.log({err})
    console.log('Sending TX again ...')
    try {
      const tx = await callback()
      console.log({tx})
      await tx.wait()
    } catch (err) {
      console.log({err})
      console.log('Can\'t resolve the issue, errored out ... ')
      throw err
    }
  }
}

const safeDeploy = async (callback) => {
  try {
    await callback()
  } catch (err) {
    console.log({err})
    console.log('Deploying again ...')
    try {
      await callback()
    } catch (err) {
      console.log({err})
      console.log('Can\'t resolve the issue, errored out ... ')
      throw err
    }
  }
}

class ENSBuilder {
  constructor(deployer) {
    this.deployer = deployer;
    this.registrars = [];
  }

  async bootstrap() {
    const emptyNode = utils.formatBytes32String(0);
    console.log('Deploying ENS registry ...')
    await safeDeploy( async () => {
      this.ens = await deployContract(this.deployer, ENSRegistry, [])
    })
    // console.log(this.ens)
    // this.ens = await deployContract(this.deployer, ENSRegistry, []);

    console.log('Deploying the main registrar ...')
    await safeDeploy( async () => {
      this.adminRegistrar = await deployContract(this.deployer, FIFSRegistrar, [this.ens.address, emptyNode])
    })
    // this.adminRegistrar = await deployContract(this.deployer, FIFSRegistrar, [this.ens.address, emptyNode]);

    console.log('Deploying PublicResolver ...')
    await safeDeploy( async () => {
      this.resolver = await deployContract(this.deployer, PublicResolver, [this.ens.address])
    })

    // let tx = await this.ens.setOwner(utils.formatBytes32String(0), this.adminRegistrar.address);
    // console.log({tx})
    // await tx.wait()

    await safeExecute( async () => {
      console.log('Setting ens owner ...')
      return await this.ens.setOwner(utils.formatBytes32String(0), this.adminRegistrar.address);
    })
  }

  async registerTLD(tld) {
    console.log(`Registering TLD ${tld}`)
    const label = utils.keccak256(utils.toUtf8Bytes(tld));
    const ethNode = utils.namehash(tld);

    await safeExecute( async () => {
      console.log('adminRegistrar.register ...')
      return await this.adminRegistrar.register(label, this.deployer.address, overrideOptions);
    })

    await safeExecute( async () => {
      console.log('ens.setResolver ...')
      return await this.ens.setResolver(ethNode, this.resolver.address, overrideOptions);
    })

    await safeDeploy( async () => {
      console.log(`Deploying registrar for "${tld}" ...`)
      this.registrars[tld] = await deployContract(this.deployer, FIFSRegistrar, [this.ens.address, ethNode])
      await this.registrars[tld].deployed()
    })

    await safeExecute( async () => {
      console.log('ens.setOwner ...')
      return await this.ens.setOwner(ethNode, this.registrars[tld].address)
    })
  }

  async registerReverseRegistrar() {
    await this.registerTLD('reverse');
    const label = 'addr';
    const labelHash = utils.keccak256(utils.toUtf8Bytes(label));

    await safeDeploy( async () => {
      console.log(`Deploying registrar for "addr.reverse" ...`)
      this.registrars['addr.reverse'] = await deployContract(this.deployer, ReverseRegistrar, [this.ens.address, this.resolver.address]);
      await this.registrars['addr.reverse'].deployed()
    })

    await safeExecute( async () => {
      console.log('registering reverse registrar ...')
      return await this.registrars.reverse.register(labelHash, this.registrars['addr.reverse'].address, overrideOptions);
    })
  }

  async registerDomain(label, domain) {
    const labelHash = utils.keccak256(utils.toUtf8Bytes(label));
    const newDomain = `${label}.${domain}`;
    const node = utils.namehash(newDomain);

    await safeExecute( async () => {
      console.log(`registering domain "${domain}"`)
      return await this.registrars[domain].register(labelHash, this.deployer.address, overrideOptions);
    })

    await safeExecute( async () => {
      console.log(`ens.setResolver ...`)
      return await this.ens.setResolver(node, this.resolver.address);
    })

    await safeDeploy( async () => {
      console.log(`deploy registrar contract for "${newDomain}" ...`)
      this.registrars[newDomain] = await deployContract(this.deployer, FIFSRegistrar, [this.ens.address, node]);
      await this.registrars[newDomain].deployed()
    })

    await safeExecute( async () => {
      console.log(`ens.setOwner ...`)
      return this.ens.setOwner(node, this.registrars[newDomain].address);
    })

    return this.registrars[newDomain];
  }

  async registerAddress(label, domain, address) {
    const node = utils.namehash(`${label}.${domain}`);
    const hashLabel = utils.keccak256(utils.toUtf8Bytes(label));
    await this.registrars[domain].register(hashLabel, this.deployer.address, overrideOptions);
    await this.ens.setResolver(node, this.resolver.address);
    await this.resolver.setAddr(node, address);
  }

  async registerAddressWithReverse(label, domain, wallet) {
    await this.registerAddress(label, domain, wallet.address);
    await this.registrars['addr.reverse'].connect(wallet).setName(`${label}.${domain}`, overrideOptions);
  }

  async bootstrapWith(label, domain) {
    await this.bootstrap();
    await this.registerTLD(domain);
    await this.registerReverseRegistrar();
    await this.registerDomain(label, domain);
    return this.ens.address;
  }
}

module.exports = ENSBuilder;

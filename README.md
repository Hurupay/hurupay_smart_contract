## Create .env file and add

- PRIVATE_KEY=your_wallet_private_key_here
- BASE_RPC_URL=https://mainnet.base.org
- BASESCAN_API_KEY= your base scan API KEY here

## Run deployment script

- `npx hardhat run scripts/deploy.js --network base`

## Veify Contract on base scan

- `npx hardhat verify --network base DEPLOYED_CONTRACT_ADDRESS "your_deployed_contract_address_here" "your_initial_fee_here"`

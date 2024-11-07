import { Contract } from '@algorandfoundation/tealscript';
const PRECISION = 1_000_000_000_000_000;

export type StakeInfo = {
  account: Address
  stake: uint64
  userSharePercentage: uint64
}
export type mbrReturn = {
  mbrPayment: uint64;
}
export type GetStakerReturn = {
  staker: StakeInfo;
  index: uint64;
}

const MAX_STAKERS_PER_POOL = 500;
const ASSET_HOLDING_FEE = 100000 // creation/holding fee for asset
const ALGORAND_ACCOUNT_MIN_BALANCE = 100000
const MINIMUM_ALGO_REWARD = 1000000


export class NoLossLottery extends Contract {
  programVersion = 10;

  //Global State

  stakers = BoxKey<StaticArray<StakeInfo, typeof MAX_STAKERS_PER_POOL>>({ key: 'stakers' })

  stakedAssetId = GlobalStateKey<uint64>();

  totalStaked = GlobalStateKey<uint64>();

  algoInjectedRewards = GlobalStateKey<uint64>();

  adminAddress = GlobalStateKey<Address>();

  minimumBalance = GlobalStateKey<uint64>();

  numStakers = GlobalStateKey<uint64>();

  commision = GlobalStateKey<uint64>();

  treasuryAddress = GlobalStateKey<Address>();

  totalCommision = GlobalStateKey<uint64>();

  createApplication(
    adminAddress: Address,
    treasuryAddress: Address
  ): void {
    this.adminAddress.value = adminAddress;
    this.treasuryAddress.value = treasuryAddress;
  }

  initApplication(
    stakedAsset: uint64,
    rewardAssetId: uint64,
    minStakePeriodForRewards: uint64,
    lstTokenId: uint64,
    commision: uint64,
    payTxn: PayTxn
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init application');

    this.stakedAssetId.value = stakedAsset;
    this.totalStaked.value = 0;
    this.numStakers.value = 0;
    this.algoInjectedRewards.value = 0;
    this.commision.value = commision;
    this.minimumBalance.value = payTxn.amount;
    this.totalCommision.value = 0;

    if (this.stakedAssetId.value !== 0) {
      sendAssetTransfer({
        xferAsset: AssetID.fromUint64(stakedAsset),
        assetReceiver: this.app.address,
        assetAmount: 0,
      })
    }
    
  }

  updateAdminAddress(adminAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update admin address');
    this.adminAddress.value = adminAddress;
  }
  updateTreasuryAddress(treasuryAddress: Address): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update treasury address');
    this.treasuryAddress.value = treasuryAddress;
  }
  updateCommision(commision: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can update commision');
    this.commision.value = commision;
  }

  private costForBoxStorage(totalNumBytes: uint64): uint64 {
    const SCBOX_PERBOX = 2500
    const SCBOX_PERBYTE = 400

    return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE
  }

  getMBRForPoolCreation(): mbrReturn {
    let nonAlgoRewardMBR = 0;

    const mbr = ALGORAND_ACCOUNT_MIN_BALANCE +
      nonAlgoRewardMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL) +
      this.costForBoxStorage(7 + len<uint64>() * 15)

    return {
      mbrPayment: mbr
    }
  }

  initStorage(mbrPayment: PayTxn): void {
    assert(!this.stakers.exists, 'staking pool already initialized')
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can init storage');

    let nonAlgoRewardMBR = 0;
    const poolMBR = ALGORAND_ACCOUNT_MIN_BALANCE +
      nonAlgoRewardMBR +
      this.costForBoxStorage(7 + len<StakeInfo>() * MAX_STAKERS_PER_POOL) +
      this.costForBoxStorage(7 + len<uint64>() * 15)

    // the pay transaction must exactly match our MBR requirement.
    verifyPayTxn(mbrPayment, { receiver: this.app.address, amount: poolMBR })
    this.stakers.create()
    this.minimumBalance.value = this.minimumBalance.value + poolMBR;
  }

  //only userd for consensus rewards
  pickupAlgoRewards(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can inject rewards');

    //total amount of newly paid in consensus rewards
    let amount = this.app.address.balance - this.minimumBalance.value - this.algoInjectedRewards.value - this.totalStaked.value;
    //less commision
    const newCommisionPayment = this.totalCommision.value + (amount / 100 * this.commision.value);
    amount = amount - newCommisionPayment;
    this.totalCommision.value = this.totalCommision.value + newCommisionPayment;
    if (amount > MINIMUM_ALGO_REWARD) {
      this.algoInjectedRewards.value += amount;
    }
  }


  deleteApplication(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can delete application');
    //assert(this.totalStaked.value === 0, 'Staked assets still exist');

    /* sendPayment({
      amount: (this.adminAddress.value.balance - this.adminAddress.value.minBalance),
      receiver: this.adminAddress.value,
      sender: this.app.address,
      fee: 1_000,
    }); */
  }

  stake(
    payTxn: PayTxn,
    quantity: uint64,
  ): void {
    const currentTimeStamp = globals.latestTimestamp;
    assert(quantity > 0, 'Invalid quantity');
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    verifyPayTxn(payTxn, {
      sender: this.txn.sender,
      amount: quantity,
      receiver: this.app.address,
    });
    let actionComplete: boolean = false;
    if (globals.opcodeBudget < 300) {
      increaseOpcodeBudget()
    }
    for (let i = 0; i < this.stakers.value.length; i += 1) {
      if (actionComplete) break;

      if (this.stakers.value[i].account === this.txn.sender) {

        //adding to current stake
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }

        const staker = clone(this.stakers.value[i])
        staker.stake += payTxn.amount

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }

        this.stakers.value[i] = staker
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.totalStaked.value = this.totalStaked.value + payTxn.amount;
        actionComplete = true;

      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.totalStaked.value = this.totalStaked.value + payTxn.amount;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.stakers.value[i] = {
          account: this.txn.sender,
          stake: payTxn.amount,
          userSharePercentage: 0,
        }
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        this.numStakers.value = this.numStakers.value + 1;
        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }
        actionComplete = true;
      }

      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
    }
    assert(actionComplete, 'Stake  failed');
  }

  optInToToken(payTxn: PayTxn, tokenId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can opt in to token');

    verifyPayTxn(payTxn, {
      receiver: this.app.address,
      amount: 110000,
    });

    sendAssetTransfer({
      xferAsset: AssetID.fromUint64(tokenId),
      assetReceiver: this.app.address,
      assetAmount: 0,
    })
  }


  payCommision(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can pay commision');
    sendPayment({
      amount: this.totalCommision.value,
      receiver: this.treasuryAddress.value,
      sender: this.app.address,
      fee: 1_000,
    });
  }



  private getStaker(address: Address): StakeInfo {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      if (this.stakers.value[i].account === address) {
        return clone(this.stakers.value[i])
      }
    }
    return {
      account: globals.zeroAddress,
      stake: 0,
      userSharePercentage: 0,
    }
  }
  private getStakerIndex(address: Address): uint64 {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      if (this.stakers.value[i].account === address) {
        return i;
      }
    }
    return 0;
  }

  private setStaker(stakerAccount: Address, staker: StakeInfo): void {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      if (this.stakers.value[i].account === stakerAccount) {
        this.stakers.value[i] = staker;
        return;
      } else if (this.stakers.value[i].account === globals.zeroAddress) {
        this.stakers.value[i] = staker;
        return;
      }
    }
  }
  private setStakerAtIndex(staker: StakeInfo, index: uint64): void {
    this.stakers.value[index] = staker;
  }

  unstake(percentageQuantity: uint64): void {
    for (let i = 0; i < this.numStakers.value; i += 1) {
      if (globals.opcodeBudget < 300) {
        increaseOpcodeBudget()
      }
      const staker = clone(this.stakers.value[i]);
      if (staker.account === this.txn.sender) {
        assert(staker.stake > 0, 'No stake to unstake');
        //quantity as a percentage of total mintedLST
        const unstakeQuantity = wideRatio([staker.stake, percentageQuantity], [100]);
        assert(unstakeQuantity > 0, 'Invalid quantity');

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }

        sendPayment({
          amount: unstakeQuantity,
          receiver: this.txn.sender,
          sender: this.app.address,
          fee: 1_000,
        });

        // Update the total staking value
        this.totalStaked.value = this.totalStaked.value - unstakeQuantity;

        if (globals.opcodeBudget < 300) {
          increaseOpcodeBudget()
        }

        if (percentageQuantity === 100) {
          const removedStaker: StakeInfo = {
            account: globals.zeroAddress,
            stake: 0,
            userSharePercentage: 0,
          }
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
          }
          this.setStaker(staker.account, removedStaker);
          //copy last staker to the removed staker position
          const lastStaker = this.getStaker(this.stakers.value[this.numStakers.value - 1].account);
          const lastStakerIndex = this.getStakerIndex(this.stakers.value[this.numStakers.value - 1].account);
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
          }
          this.setStakerAtIndex(lastStaker, i);
          //remove old record of last staker
          this.setStakerAtIndex(removedStaker, lastStakerIndex);
          this.numStakers.value = this.numStakers.value - 1;
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
          }
        } else {
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
          }
          staker.stake = staker.stake - unstakeQuantity;
          this.setStaker(staker.account, staker);
          if (globals.opcodeBudget < 300) {
            increaseOpcodeBudget()
          }
        }
        break;
      }

    }
  }


  private getGoOnlineFee(): uint64 {
    // this will be needed to determine if our pool is currently NOT eligible and we thus need to pay the fee.
    /*  if (!this.app.address.incentiveEligible) {
       return globals.payoutsGoOnlineFee
     } */
    return 2_000_000;
  }

  goOnline(
    feePayment: PayTxn,
    votePK: bytes,
    selectionPK: bytes,
    stateProofPK: bytes,
    voteFirst: uint64,
    voteLast: uint64,
    voteKeyDilution: uint64,
  ): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can go online')

    const extraFee = this.getGoOnlineFee()
    verifyPayTxn(feePayment, {
      receiver: this.app.address, amount: extraFee
    })
    sendOnlineKeyRegistration({
      votePK: votePK,
      selectionPK: selectionPK,
      stateProofPK: stateProofPK,
      voteFirst: voteFirst,
      voteLast: voteLast,
      voteKeyDilution: voteKeyDilution,
      fee: extraFee,
    })
  }


  goOffline(): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can go offline')
    sendOfflineKeyRegistration({})
  }

  linkToNFD(nfdAppId: uint64, nfdName: string, nfdRegistryAppId: uint64): void {
    assert(this.txn.sender === this.adminAddress.value, 'Only admin can link to NFD')

    sendAppCall({
      applicationID: AppID.fromUint64(nfdRegistryAppId),
      applicationArgs: ['verify_nfd_addr', nfdName, itob(nfdAppId), rawBytes(this.app.address)],
      applications: [AppID.fromUint64(nfdAppId)],
    })
  }


  gas(): void { }
}




/** @param {import(".").NS } ns */
export async function main(ns) {
    desableLogs(ns);

    //clear log and print start info
    ns.clearLog();
	ns.print('');
	ns.print('---- autoscale script starting ----');

    //current hack skill
    var hackSkill = ns.getHackingLevel();
    
    //index of purchased servers
    var purchasedServers = ns.getPurchasedServers();
    
    //scanned servers (inc. recursive scan)
    var scannedServers = ns.scan(ns.getHostname());
    
    //hackable servers based on your hacking lvl
    var hackableServers = [];
    
    //index of running scripts
    var runningScripts = {};
    
    //count of dynamic sripts
    var totalScripts = 0;

    //total ram that can be used from hackable servers
    var totalRam = 0;

    //max ram that each script should use
    var scriptMaxRam = 0;

    //nex free server to start a script
    var nextFreeServer = 'home_0001';

    //wheter the script should run external or not
    var runExternal = true;

    //how deep to scan (scan v2 has max depth of 10)
    var scanDepth = 40;

    //set installed/purchased programms
    var avProg = [
        'BruteSSH',
		'FTPCrack',
		'relaySMTP',
		'HTTPWorm',
		'SQLInject',
    ];

    scanDeep();
    await updateHackableServers();
    killAllThreads();
    await updateDynamicScripts();
    setTotalRam();

    await ns.sleep(5000);

    while(true){
        scanDeep();
        await updateHackableServers();
        for(var hsi in hackableServers){
            await ns.sleep(200);
            var server = hackableServers[hsi];
            if(server == ns.getHostname() || server.includes('home_')) continue;
			if(runningScripts[server] != undefined && runningScripts[server].threads >= runningScripts[server].maxthreads) continue;

            var threads = 0;
			var loopCount = 0;
            while(loopCount < hackableServers.length){
                loopCount++;
                nextFreeServer = getNexFreeServer(ns.getScriptRam(server+'.js'), server);
                if(nextFreeServer){
                    threads = Math.floor(((ns.getServerMaxRam(nextFreeServer) - ns.getServerUsedRam(nextFreeServer)) / ns.getScriptRam(server+'.js')));
                    if(threads<1) break;
                    if(runningScripts[server] != undefined && threads > (runningScripts[server].maxthreads - runningScripts[server].threads)) threads = runningScripts[server].maxthreads - runningScripts[server].threads;
                    nextFreeServer = getNexFreeServer(ns.getScriptRam(server+'.js') * threads, server);

                    var freeRamBefore = ns.getServerMaxRam(nextFreeServer) - ns.getServerUsedRam(nextFreeServer);
                    if(nextFreeServer) {
                        if(runningScripts[server] != undefined && !ns.scriptRunning(server+'.js',nextFreeServer) && runningScripts[server].threads < runningScripts[server].maxthreads){
                            await ns.exec(server+'.js',nextFreeServer,threads);
                            if(ns.scriptRunning(server+'.js',nextFreeServer)){
                                ns.print('script started on server'+ nextFreeServer);
                                runningScripts[server].threads += threads;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    //get next server which has free ram
    function getNexFreeServer(needRam, srcServer){
		ns.print('need ram: '+ needRam);
		ns.print('src server: '+ srcServer);
		var nextServer = false;
		for(var hsia in (runExternal ? hackableServers : purchasedServers)){
			var servera = (runExternal ? hackableServers : purchasedServers)[hsia];
			ns.print('server in loop: '+ servera);
			var maxRam = ns.getServerMaxRam(servera);
			var usedRam = ns.getServerUsedRam(servera);
			ns.print('free ram: '+ (maxRam - usedRam));
			if(srcServer == servera || maxRam - usedRam <= needRam) continue;
			nextServer = servera;
			break;
		}
		ns.print('next server: '+ nextServer);
		if(nextServer == false) runExternal = true;
		return nextServer;
	}

    //update dynamic scripts
    async function updateDynamicScripts(){
        ns.print('install/update scripts');
        for(var i in hackableServers){
            var server = hackableServers[i];
            //start dynamic script template start
            /**
             * i think this part can/should be optimized. didnt spend much time on it.
             */
            await ns.write(server+'.js',`
                export async function main(ns) {
                    while(true){
                        if(ns.getServerGrowth('`+server+`') + 50 < ns.getHackingLevel()){
                            await ns.grow('`+server+`');
                        } else {
                            await ns.weaken('`+server+`');
                        }
                        await ns.hack('`+server+`');
                    }
                }
            `,'w');
            //end dynamic script template end
            for(var ii in hackableServers){
                await ns.scp(server+'.js',hackableServers[ii]);
            }
            for(var ii in purchasedServers){
                await ns.scp(server+'.js',purchasedServers[ii]);
            }
        }
    }

    //add empty template for a runnung script
    function setupRunningScriptTemplate(servername){
        runningScripts[servername] = {
            'threads': 0,
            'maxthreads': false
        }
    }

    //kill all running dynimic scripts on all servers
    function killAllThreads(){
        for(var hsib in scannedServers){
			var scs = scannedServers[hsib];
			if(ns.hasRootAccess(scs)){
				for(var hsii in scannedServers){
					var serveri = scannedServers[hsii];
					if(ns.scriptRunning(serveri+'.js',scs)){
						ns.scriptKill(serveri+'.js',scs);
					}
				}
				if(ns.scriptRunning(scs+'.js',scs)){
					ns.scriptKill(scs+'.js',scs);
				}
			}
		}
    }

    //calculate max ram that each dynamic script can consume
    function setTotalRam(){
		totalScripts = 0;
		totalRam = 0;
		for(var hsib in scannedServers){
			var scs = scannedServers[hsib];
			if(ns.hasRootAccess(scs)){
				totalRam += (ns.getServerMaxRam(scs) - ns.getServerUsedRam(scs));

                //add server to the running script index
				if(scs != ns.getHostname() && !scs.includes('home_')){
					if(runningScripts[scs] == undefined) {
						setupRunningScriptTemplate(scs);
					}
					totalScripts++;
				}
			}
		}
		scriptMaxRam = (totalRam/totalScripts) - 1;
		var tmpMax = Object.assign(scriptMaxRam,scriptMaxRam);
		for(var hsiic in scannedServers){
			var serveric = scannedServers[hsiic];
			if(runningScripts[serveric] != undefined && runningScripts[serveric]['maxthreads'] == false){
				runningScripts[serveric].maxthreads = Math.floor(tmpMax / ns.getScriptRam(serveric+'.js'));
			}
		}
	}

    //update hackable server list
    async function updateHackableServers(){
        for(var shs in scannedServers){
            var needSkill = ns.getServerRequiredHackingLevel(scannedServers[shs]);
            hackSkill = ns.getHackingLevel();
            if(hackSkill >= needSkill){
                if(!hackableServers.includes(scannedServers[shs])){
                    //open ports
                    for(var osf in avProg){
						var srcFile = avProg[osf];
                        if(!ns.fileExists(srcFile+'.exe')) continue;
						switch(srcFile){
							case 'BruteSSH':
								await ns.brutessh(scannedServers[shs]);
							break;
							case 'FTPCrack':
								await ns.ftpcrack(scannedServers[shs]);
							break;
							case 'HTTPWorm':
								await ns.httpworm(scannedServers[shs]);
							break;
							case 'SQLInject':
								await ns.sqlinject(scannedServers[shs]);
							break;
							case 'relaySMTP':
								await ns.relaysmtp(scannedServers[shs]);
							break;
						}
					}

                    //nuke
                    if(!ns.hasRootAccess(scannedServers[shs]) && ns.getServerNumPortsRequired(scannedServers[shs]) <= ns.getServer(scannedServers[shs]).openPortCount){
                        await ns.nuke(scannedServers[shs]);
                    }

                    if(ns.hasRootAccess(scannedServers[shs])){
                        //rescale if new server was purchased or has root access
                        killAllThreads();
                        runningScripts = {};
                        totalScripts = 0;
                        totalRam = 0;
                        scriptMaxRam = 0;
                        setTotalRam();
                        hackableServers.push(scannedServers[shs]);
                        scanDeep();
                        await updateDynamicScripts();
                    }
                }
            }
        }
        if(!hackableServers.includes(ns.getHostname())){
            hackableServers.push(ns.getHostname());
        }
    }

    //scann servers recursive
    function scanDeep(){
        var depth = 0;
        var scans = ns.scan(ns.getHostname());
        scans.push(ns.getHostname());
        while(depth < scanDepth){
            var scannedRescServers = [];
            for(var shs in scans){
                var sscan = ns.scan(scans[shs]);
                for(var ssci in sscan){
                    if(!scannedRescServers.includes(sscan[ssci])) {
                        scannedRescServers.push(sscan[ssci]);
                    }
                }
            }
            for(var sesi in scannedRescServers){
                if(!scannedServers.includes(scannedRescServers[sesi])) {
                    scannedServers.push(scannedRescServers[sesi]);
                }
            }
            scans = scannedServers;
            depth++;
        }

        //add purchased servers to scanned servers
        purchasedServers = ns.getPurchasedServers();
        for(var puservi in purchasedServers){
            if(!scannedServers.includes(purchasedServers[puservi])){
                scannedServers.push(purchasedServers[puservi]);
            }
        }
    }

    //desable default logs
    function desableLogs(){
        ns.disableLog('getHostname');
        ns.disableLog('getPlayer');
        ns.disableLog('scan');
        ns.disableLog('getServerMaxRam');
        ns.disableLog('getServerUsedRam');
        ns.disableLog('brutessh');
        ns.disableLog('ftpcrack');
        ns.disableLog('sleep');
        ns.disableLog('run');
        ns.disableLog('sleep');
        ns.disableLog('getServerRequiredHackingLevel');
        ns.disableLog('getServerNumPortsRequired');
        ns.disableLog('getServerGrowth');
        ns.disableLog('getServerMoneyAvailable');
        ns.disableLog('getHackingLevel');
        ns.disableLog('scp');
    }   
}

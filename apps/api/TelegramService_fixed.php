<?php

namespace App\Services;

use danog\MadelineProto\API;
use danog\MadelineProto\Settings;
use danog\MadelineProto\Settings\AppInfo;

class TelegramService
{
    protected $madeline;

    public function __construct()
    {
        // MadelineProto spawns IPC worker sub-processes via proc_open() but never
        // calls proc_close() on them, leaving [sh] zombies in the process table.
        // SIG_IGN on SIGCHLD instructs the kernel to auto-reap those children
        // the moment they exit, without the parent needing to call wait().
        if (function_exists('pcntl_signal')) {
            pcntl_signal(SIGCHLD, SIG_IGN);
        }

        $settings = new Settings();
        $appInfo = new AppInfo();
        $appInfo->setApiId((int) env('TELEGRAM_API_ID'));
        $appInfo->setApiHash(env('TELEGRAM_API_HASH'));
        $settings->setAppInfo($appInfo);

        $this->madeline = new API(storage_path('telegram.madeline'), $settings);
    }

    public function start()
    {
        $this->madeline->start();
    }

    public function getClient()
    {
        return $this->madeline;
    }
}

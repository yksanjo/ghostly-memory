#!/usr/bin/env node

import { program } from './cli/index.js';
import 'dotenv/config';

program.parse();
